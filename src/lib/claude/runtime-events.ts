// Best-effort, append-only event log for Claude SDK runtime decisions.
//
// The motivating incident: a long-running IM conversation went through several
// successful resume turns and then suddenly fell back to a fresh SDK session
// — and a transcript that lived in the old session was lost to the model.
// The fallback fanned out across three `emitStatus(...)` call sites that only
// went out as SSE frames; nothing was on disk, so post-mortem had to be
// reverse-engineered from JSONL timestamps and DB rows.
//
// This logger records the same key transitions to `~/.lumos/claude-runtime.log`
// as one JSON object per line, so the next time someone says "the AI forgot
// what we just talked about" we can `grep $session_id` and immediately see:
//
//   - whether the prior session was dropped on purpose (and why)
//   - whether SDK resume threw and was caught
//   - which MCP signature was matched against what
//
// Writes are synchronous + try/catch — logging failures must never affect
// the live request.

import fs from 'fs';
import path from 'path';
import { getRuntimeDataDir } from '@/lib/runtime-resources';

const LOG_FILE_NAME = 'claude-runtime.log';

export type RuntimeEventName =
  | 'resume_dropped_force_fresh'
  | 'resume_dropped_cwd_missing'
  | 'resume_dropped_mcp_changed'
  | 'resume_failed_at_runtime'
  | 'session_started_fresh'
  | 'session_resumed'
  // IM inbound dispatcher events — capture cases where the agent returned
  // no visible text so the chat looks "silent" to the user. We log the
  // length of the visible vs raw content + a small preview so we can tell
  // whether the LLM emitted only tool_use, or sanitizer stripped everything.
  | 'im_inbound_empty_reply';

export interface RuntimeEventInput {
  sessionId?: string;
  sdkSessionId?: string;
  event: RuntimeEventName;
  detail?: Record<string, unknown>;
}

function getLogFilePath(): string {
  return path.join(getRuntimeDataDir(), LOG_FILE_NAME);
}

export function recordRuntimeEvent(event: RuntimeEventInput): void {
  const payload = { ts: new Date().toISOString(), ...event };
  try {
    fs.appendFileSync(getLogFilePath(), `${JSON.stringify(payload)}\n`, 'utf-8');
  } catch {
    // best effort — never let logging crash the runtime
  }
}
