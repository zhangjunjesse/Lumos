const TOOL_TRACE_PREFIXES = [
  '[Used tool:',
  '[Tool result:',
  '[Reasoning summary:',
] as const;

function tracePrefixAt(text: string, index: number): string | null {
  for (const prefix of TOOL_TRACE_PREFIXES) {
    if (text.startsWith(prefix, index)) return prefix;
  }
  return null;
}

function findTraceMarkerEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === ']') {
      depth -= 1;
      if (depth <= 0) return i + 1;
    }
  }

  return text.length;
}

function cleanupAfterStrip(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/([。！？；：，])\s+(?=[\u3400-\u9fff])/g, '$1')
    .trim();
}

/**
 * Strip fallback-history tool markers that are internal to Lumos and should
 * never be displayed to users or forwarded to IM channels.
 */
export function stripLeakedToolTraceText(text: string): string {
  if (!text || !TOOL_TRACE_PREFIXES.some((prefix) => text.includes(prefix))) {
    return text;
  }

  let out = '';
  let i = 0;
  let changed = false;
  while (i < text.length) {
    const prefix = tracePrefixAt(text, i);
    if (!prefix) {
      out += text[i];
      i += 1;
      continue;
    }

    changed = true;
    out = out.replace(/[ \t]+$/g, '');
    i = findTraceMarkerEnd(text, i);
    while (i < text.length && /[ \t]/.test(text[i])) i += 1;
    if (out && i < text.length && !/[\s,，。.!?！？;；:：]/.test(text[i])) {
      out += ' ';
    }
  }

  return changed ? cleanupAfterStrip(out) : text;
}
