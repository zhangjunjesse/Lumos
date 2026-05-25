// Conversation-history fallback for the Claude Agent SDK runtime.
//
// When SDK session resume is unavailable (first turn, MCP toolset changed,
// resume failed, etc.) we hand-roll a `<conversation_history>` block in the
// prompt so the model still sees what already happened.
//
// The non-obvious part is **what we preserve**. The old implementation kept
// only `type: 'text'` blocks from each assistant turn and stripped routing
// directives wholesale from each user turn. That quietly dropped:
//
//   - `tool_use` calls (the model could not tell it had already invoked a
//     tool, and would call it again — sometimes hallucinating arguments)
//   - `tool_result` payloads (transcription text, browser snapshots, search
//     results — the model lost the data it just paid for)
//   - the `<!--files:[...]-->` directive's absolute file paths (the model
//     remembered the filename "foo.m4a" but not where it lived on disk)
//
// Anything that survives must be cheap enough to fit the per-message budget
// (`FALLBACK_HISTORY_MESSAGE_MAX_CHARS`) and the overall history budget
// (`FALLBACK_HISTORY_MAX_CHARS`). Truncation is done with a visible marker
// so the model can tell where data was cut.

export const FALLBACK_HISTORY_MAX_CHARS = 80_000;
export const FALLBACK_HISTORY_MESSAGE_MAX_CHARS = 12_000;

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Hard cap: the returned string is always ≤ maxChars. `buildPromptWithHistory`
// relies on this to keep its running char budget accurate; without the hard
// cap, every truncated message silently overshoots by ~30 chars (the length
// of the truncation marker) and history bleeds past the configured limit.
const TRUNCATION_MARKER = '\n\n[… truncated]';

export function truncateHistoryText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= TRUNCATION_MARKER.length) return text.slice(0, maxChars);
  return text.slice(0, maxChars - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

// `tool_result.content` can be a string or an array of content blocks
// depending on the tool. We flatten to plain text so the next turn can read
// the substance without parsing SDK block shapes.
export function extractToolResultText(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block) continue;
      if (typeof block === 'string') { parts.push(block); continue; }
      if (typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    }
    return parts.join('\n');
  }
  try { return JSON.stringify(content); } catch { return ''; }
}

export function previewToolInput(input: unknown, maxChars = 400): string {
  if (input == null) return '';
  try {
    const json = typeof input === 'string' ? input : JSON.stringify(input);
    if (!json) return '';
    return json.length > maxChars ? `${json.slice(0, maxChars)}…` : json;
  } catch {
    return '';
  }
}

// Parse a `<!--files:[{...}]-->` directive (emitted by IM/chat ingestion)
// into one human-readable line per attachment. The on-disk `filePath` is
// the load-bearing field — the model needs it to call tools like
// `transcribe_audio` that take a path.
export function renderFileDirective(raw: string): { lines: string[]; rest: string } | null {
  const match = raw.match(/^<!--files:(\[[\s\S]*?\])-->/);
  if (!match) return null;
  try {
    const files = JSON.parse(match[1]);
    if (!Array.isArray(files)) return null;
    const lines: string[] = [];
    for (const f of files) {
      if (!f || typeof f !== 'object') continue;
      const file = f as Record<string, unknown>;
      const name = typeof file.name === 'string' ? file.name : '(unnamed)';
      const filePath = typeof file.filePath === 'string' ? file.filePath : '';
      const type = typeof file.type === 'string' ? file.type : '';
      const descriptorParts = [`name="${name}"`];
      if (filePath) descriptorParts.push(`path=${filePath}`);
      if (type) descriptorParts.push(`type=${type}`);
      lines.push(`[Attached file: ${descriptorParts.join(', ')}]`);
    }
    return { lines, rest: raw.slice(match[0].length) };
  } catch {
    return null;
  }
}

export function normalizeHistoryMessageForFallback(msg: HistoryMessage): string {
  const raw = msg.content || '';

  if (msg.role === 'assistant' && raw.startsWith('[')) {
    try {
      const blocks = JSON.parse(raw);
      if (Array.isArray(blocks)) {
        const parts: string[] = [];
        for (const block of blocks) {
          if (!block || typeof block !== 'object') continue;
          const b = block as Record<string, unknown>;
          if (b.type === 'text' && typeof b.text === 'string') {
            parts.push(b.text);
          } else if (b.type === 'tool_use' && typeof b.name === 'string') {
            const preview = previewToolInput(b.input);
            parts.push(preview ? `[Called tool ${b.name}(${preview})]` : `[Called tool ${b.name}]`);
          } else if (b.type === 'tool_result') {
            const text = extractToolResultText(b.content);
            if (text) {
              const isErr = b.is_error === true;
              const tag = isErr ? 'Tool error' : 'Tool result';
              parts.push(`[${tag}: ${truncateHistoryText(text, FALLBACK_HISTORY_MESSAGE_MAX_CHARS)}]`);
            }
          }
        }
        return truncateHistoryText(parts.join('\n'), FALLBACK_HISTORY_MESSAGE_MAX_CHARS);
      }
    } catch {
      // Not structured JSON; fall through to plain text truncation.
    }
  }

  if (msg.role === 'user' && raw.startsWith('<!--files:')) {
    const rendered = renderFileDirective(raw);
    if (rendered) {
      const tail = rendered.rest.replace(/<!--[a-zA-Z0-9_-]+:[\s\S]*?-->/g, '').trim();
      const combined = [...rendered.lines, tail].filter(Boolean).join('\n');
      return truncateHistoryText(combined, FALLBACK_HISTORY_MESSAGE_MAX_CHARS);
    }
  }

  return truncateHistoryText(raw, FALLBACK_HISTORY_MESSAGE_MAX_CHARS);
}

// Build a `<conversation_history>` … prompt that walks newest → oldest so the
// model still sees the most recent turns even if the overall budget forces
// us to drop the older ones.
export function buildPromptWithHistory(prompt: string, history?: HistoryMessage[]): string {
  if (!history || history.length === 0) return prompt;

  const lines: string[] = ['<conversation_history>'];
  const selected: string[] = [];
  let usedChars = 0;
  let omittedMessages = 0;

  for (let index = history.length - 1; index >= 0; index--) {
    const msg = history[index];
    const label = msg.role === 'user' ? 'Human' : 'Assistant';
    const content = normalizeHistoryMessageForFallback(msg).trim();
    if (!content) continue;

    const line = `${label}: ${content}`;
    const remainingChars = FALLBACK_HISTORY_MAX_CHARS - usedChars;
    if (remainingChars <= 1_000) {
      omittedMessages = index + 1;
      break;
    }

    if (line.length > remainingChars) {
      const contentBudget = Math.max(500, remainingChars - label.length - 4);
      selected.push(`${label}: ${truncateHistoryText(content, contentBudget)}`);
      omittedMessages = index;
      break;
    }

    selected.push(line);
    usedChars += line.length + 1;
  }

  if (omittedMessages > 0) {
    lines.push(`[Earlier ${omittedMessages} messages omitted because fallback history is capped.]`);
  }
  lines.push(...selected.reverse());
  lines.push('</conversation_history>');
  lines.push('');
  lines.push(prompt);
  return lines.join('\n');
}
