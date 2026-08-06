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
  | 'stream_context_prepared'
  | 'model_first_response_timeout'
  | 'session_started_fresh'
  | 'session_resumed'
  // MCP 连接态(#57):SDK init 消息里带每个 server 的 connected/failed/pending…
  // 此前完全没记,于是"工具时有时无"只能靠猜——注册表看着好好的,日志里却
  // 没有任何一条能证明进程到底连上没有。两个事件分开:
  //   mcp_servers_connected —— 每次 init 的全量快照(谁连上了/谁没有)
  //   mcp_server_unavailable —— 单独拎出非 connected 的,便于 grep 定位
  | 'mcp_servers_connected'
  | 'mcp_server_unavailable'
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
