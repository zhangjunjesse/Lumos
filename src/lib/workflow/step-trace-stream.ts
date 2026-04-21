/**
 * Live per-step trace stream. The Claude Agent SDK already delivers messages
 * from `StageWorker` as they arrive, but the workflow engine used to buffer
 * them in memory and only persist after the step finished — so the run detail
 * UI saw nothing until the whole step completed.
 *
 * This module appends each assistant/user message to a per-stage `jsonl`
 * file (`_lumos_step_trace.jsonl`, next to the input snapshot) as soon as it
 * arrives, and exposes tail readers so the run detail API can hand the UI a
 * fresh slice on every poll.
 *
 * The file is written at the stage workspace root (NOT under `output/`), so
 * the output-file walker (which only recurses into `output/`) ignores it.
 */
import { appendFile, mkdir, readFile, readdir, stat } from 'fs/promises';
import path from 'path';

export type TraceKind = 'text' | 'thinking' | 'tool_use' | 'tool_result';

export interface StepTraceEvent {
  /** ISO timestamp captured when we received the SDK message. */
  t: string;
  role: 'assistant' | 'user';
  kind: TraceKind;
  /** Tool name for tool_use / tool_result blocks. */
  name?: string;
  /** Text content for text / thinking / tool_result blocks (clipped). */
  text?: string;
  /** JSON-stringified tool input (clipped) — only for tool_use. */
  inputPreview?: string;
  /** tool_result `is_error` flag — only for tool_result. */
  isError?: boolean;
}

const TRACE_FILE = '_lumos_step_trace.jsonl';
const MAX_FIELD_LEN = 2048;

/** Per-file promise chain so concurrent appends don't interleave. */
const writeChains = new Map<string, Promise<void>>();

function clip(s: string, max = MAX_FIELD_LEN): string {
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max)}…[+${s.length - max}B]` : s;
}

function stringifyPreview(value: unknown): string {
  try {
    return clip(JSON.stringify(value) ?? '');
  } catch {
    return '[unserializable]';
  }
}

function flattenSdkEvent(sdkEvent: unknown): StepTraceEvent[] {
  const now = new Date().toISOString();
  const msg = sdkEvent as { type?: string; message?: { content?: Array<Record<string, unknown>> } };
  const role = msg?.type === 'assistant' ? 'assistant' : msg?.type === 'user' ? 'user' : null;
  if (!role) return [];
  const blocks = msg?.message?.content;
  if (!Array.isArray(blocks)) return [];
  const out: StepTraceEvent[] = [];
  for (const b of blocks) {
    const btype = (b as { type?: string })?.type;
    if (btype === 'text') {
      const text = (b as { text?: string }).text;
      if (text) out.push({ t: now, role, kind: 'text', text: clip(text) });
    } else if (btype === 'thinking') {
      const text = (b as { thinking?: string }).thinking;
      if (text) out.push({ t: now, role, kind: 'thinking', text: clip(text) });
    } else if (btype === 'tool_use') {
      const name = (b as { name?: string }).name;
      const input = (b as { input?: unknown }).input;
      out.push({ t: now, role, kind: 'tool_use', name: name ?? 'unknown', inputPreview: stringifyPreview(input) });
    } else if (btype === 'tool_result') {
      const content = (b as { content?: unknown }).content;
      const isError = Boolean((b as { is_error?: boolean }).is_error);
      let text = '';
      if (typeof content === 'string') {
        text = content;
      } else if (Array.isArray(content)) {
        text = content.map((c) => {
          const ct = (c as { type?: string }).type;
          if (ct === 'text') return (c as { text?: string }).text ?? '';
          return `[${ct ?? 'non-text'}]`;
        }).join('\n');
      } else if (content !== undefined) {
        text = stringifyPreview(content);
      }
      out.push({ t: now, role, kind: 'tool_result', text: clip(text), isError });
    }
  }
  return out;
}

/**
 * Fire-and-forget append. Serializes concurrent appends via a per-file
 * promise chain so line order reflects event arrival order.
 */
export function appendStepTraceFromSdkEvent(
  stageWorkspace: string,
  sdkEvent: unknown,
): void {
  const events = flattenSdkEvent(sdkEvent);
  if (events.length === 0) return;
  const lines = events.map((e) => `${JSON.stringify(e)}\n`).join('');
  const filePath = path.join(stageWorkspace, TRACE_FILE);
  const prev = writeChains.get(filePath) ?? Promise.resolve();
  const next = prev.then(async () => {
    try {
      await mkdir(stageWorkspace, { recursive: true });
      await appendFile(filePath, lines, 'utf-8');
    } catch (e) {
      console.warn('[step-trace] append failed:', e instanceof Error ? e.message : e);
    }
  });
  writeChains.set(filePath, next);
  void next.finally(() => {
    if (writeChains.get(filePath) === next) writeChains.delete(filePath);
  });
}

export async function readStepTraceTail(
  stageWorkspace: string,
  maxLines: number,
): Promise<StepTraceEvent[]> {
  const filePath = path.join(stageWorkspace, TRACE_FILE);
  try {
    const buf = await readFile(filePath, 'utf-8');
    const lines = buf.split('\n').filter(Boolean);
    const tail = lines.slice(-maxLines);
    const out: StepTraceEvent[] = [];
    for (const line of tail) {
      try { out.push(JSON.parse(line) as StepTraceEvent); } catch { /* skip malformed */ }
    }
    return out;
  } catch {
    return [];
  }
}

export async function collectRunLiveTraces(
  runWorkspaceRoot: string,
  maxPerStep = 200,
): Promise<Record<string, StepTraceEvent[]>> {
  const stagesDir = path.join(runWorkspaceRoot, 'stages');
  try {
    const info = await stat(stagesDir);
    if (!info.isDirectory()) return {};
  } catch { return {}; }
  const stageIds = await readdir(stagesDir).catch(() => [] as string[]);
  const out: Record<string, StepTraceEvent[]> = {};
  for (const stageId of stageIds) {
    const events = await readStepTraceTail(path.join(stagesDir, stageId), maxPerStep);
    if (events.length > 0) out[stageId] = events;
  }
  return out;
}
