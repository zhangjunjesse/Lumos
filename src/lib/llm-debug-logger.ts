// Append-only diagnostic log for LLM structured-output call chains.
//
// Background: generateObjectWithFallback can fail at any of six points
// (provider error, fallback decision, text generation, JSON extraction,
// JSON parse, schema validation). When the user sees a final Error like
// "Expected ',' or '}' at position 800", every intermediate signal is gone
// — we cannot tell whether the model returned trailing commas, ran out of
// tokens, leaked an explanation outside the JSON, or matched the wrong
// candidate. Without that information any "fix" is a guess.
//
// This logger records each stage to `~/.lumos/llm-debug.log` (JSON Lines)
// so a single repro on the user's machine yields enough evidence to
// pinpoint the real root cause, without us having to ship another build
// just to add print statements.
//
// IMPORTANT — this is **not** a swallow-the-error mechanism. Callers still
// rethrow the original error; this module only persists context to disk.

import fs from 'fs';
import path from 'path';
import { getRuntimeDataDir } from '@/lib/runtime-resources';

const LOG_FILE_NAME = 'llm-debug.log';

// Hard cap per-entry to keep the file from exploding on huge model outputs.
// 128 KB is enough to capture full transcripts of typical JSON generations
// (DeepSeek/GPT/Claude rarely exceed this for one call) and still lets us
// see leading + trailing context even if the response is enormous.
const MAX_FIELD_CHARS = 128 * 1024;

export type LlmDebugStage =
  | 'request_started'
  | 'request_succeeded'
  | 'fallback_to_text'
  | 'json_extract_failed'
  | 'json_parse_failed'
  | 'schema_validation_failed'
  | 'request_failed';

export interface LlmDebugEntry {
  requestId: string;
  stage: LlmDebugStage;
  providerId?: string;
  model?: string;
  module?: string;
  operation?: string;
  detail?: Record<string, unknown>;
}

function getLogFilePath(): string {
  return path.join(getRuntimeDataDir(), LOG_FILE_NAME);
}

function clipForLog(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_FIELD_CHARS
      ? `${value.slice(0, MAX_FIELD_CHARS)}…[+${value.length - MAX_FIELD_CHARS} chars]`
      : value;
  }
  return value;
}

function sanitizeDetail(detail?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!detail) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) out[k] = clipForLog(v);
  return out;
}

export function recordLlmDebug(entry: LlmDebugEntry): void {
  const payload = {
    ts: new Date().toISOString(),
    ...entry,
    detail: sanitizeDetail(entry.detail),
  };
  try {
    fs.appendFileSync(getLogFilePath(), `${JSON.stringify(payload)}\n`, 'utf-8');
  } catch {
    // best effort — diagnostics must never crash the runtime
  }
}

// Extract a window of text around a JSON SyntaxError's "position N" marker
// so the engineer reading the log can see the exact bytes that confused the
// parser, plus what came before/after. JSON.parse errors are notoriously
// terse: the parser only tells you the position, not the surrounding bytes.
export function extractContextAroundError(jsonText: string, err: unknown): string | undefined {
  if (!(err instanceof Error)) return undefined;
  const match = err.message.match(/position\s+(\d+)/i);
  if (!match) return undefined;
  const pos = Number(match[1]);
  if (!Number.isFinite(pos)) return undefined;
  const radius = 200;
  const start = Math.max(0, pos - radius);
  const end = Math.min(jsonText.length, pos + radius);
  const window = jsonText.slice(start, end);
  const caretOffset = Math.min(pos - start, window.length);
  // Add a caret line marking the exact failing column so the file is
  // human-readable in `tail -f` / Notepad without needing to count chars.
  const caret = `${' '.repeat(caretOffset)}^^^ ERROR HERE (position ${pos})`;
  return `${window}\n${caret}`;
}
