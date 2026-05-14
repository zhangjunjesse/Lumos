/**
 * Orchestrates streaming sync from api.py → mirror SQLite.
 *
 * Design:
 *   - api.py runs in `sync_stream` mode and emits NDJSON.
 *   - We sink each `{type:"msg"}` row into a 500-row write buffer.
 *   - Buffer flushes via batched INSERT OR IGNORE, returning new-row counts.
 *   - Sessions metadata arrives early as `{type:"meta"}` and is upserted.
 *   - One in-flight sync allowed at a time (module-level mutex).
 *
 * The engine is intentionally framework-free so it can be invoked from a
 * route handler (NDJSON stream out) or a scheduler tick (no consumer).
 */

import { streamWeChatApi } from '@/lib/wechat-export/api-bridge';
import { hasValidConsent } from '@/lib/wechat-export/disclaimer';
import { hasRecoveredKey } from '@/lib/wechat-export/setup-state';

import {
  getLatestMessageTs,
  getSyncState,
  insertMessages,
  markSyncFinished,
  markSyncStarted,
  resetMirror,
  setCursor,
  setLastError,
  upsertSessions,
  type MirrorMessage,
  type MirrorSession,
  type WeChatMirrorAttachment,
} from './mirror-store';

const FLUSH_THRESHOLD = 500;
/** When a sync triggers within this many ms of last finish, fast-skip. */
export const FRESH_WINDOW_MS = 5 * 60 * 1000; // 5 min
/** Re-fetch a 60s overlap window so messages straddling the cursor aren't missed. */
const OVERLAP_SECONDS = 60;

export type SyncProgressEvent =
  | { type: 'start'; cursorTs: number; firstSync: boolean }
  | { type: 'sessions'; count: number }
  | { type: 'db_start'; db: string; tables: number }
  | { type: 'progress'; messagesInserted: number; messagesSeen: number; currentDb: string | null }
  | { type: 'db_done'; db: string; messages: number }
  | { type: 'done'; messagesInserted: number; messagesSeen: number; cursorTs: number; durationMs: number }
  | { type: 'error'; message: string }
  | { type: 'skipped'; reason: 'unsupported_platform' | 'consent_required' | 'no_key' | 'in_progress' };

export interface RunSyncOptions {
  /** If true, ignore the mirror cursor and re-pull from t=0. */
  fullResync?: boolean;
  /** External abort handle for the long-running stream. */
  signal?: AbortSignal;
  onEvent?: (event: SyncProgressEvent) => void;
}

let inFlight: Promise<SyncResult> | null = null;

export interface SyncResult {
  status: 'completed' | 'skipped' | 'failed';
  reason?: 'unsupported_platform' | 'consent_required' | 'no_key' | 'in_progress';
  inserted: number;
  seen: number;
  cursorTs: number;
  durationMs: number;
  error?: string;
}

export function isSyncInFlight(): boolean {
  return inFlight !== null;
}

export async function runSync(options: RunSyncOptions = {}): Promise<SyncResult> {
  if (inFlight) {
    options.onEvent?.({ type: 'skipped', reason: 'in_progress' });
    return inFlight;
  }
  inFlight = doRunSync(options).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRunSync(options: RunSyncOptions): Promise<SyncResult> {
  const t0 = Date.now();
  const emit = options.onEvent ?? (() => undefined);

  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    emit({ type: 'skipped', reason: 'unsupported_platform' });
    return failSkip('unsupported_platform', t0);
  }
  if (!hasValidConsent()) {
    emit({ type: 'skipped', reason: 'consent_required' });
    return failSkip('consent_required', t0);
  }
  if (!hasRecoveredKey()) {
    emit({ type: 'skipped', reason: 'no_key' });
    return failSkip('no_key', t0);
  }

  if (options.fullResync) {
    resetMirror();
  }

  const state = getSyncState();
  const isFirstSync = state.cursorTs === 0;
  const latestStoredMessageTs = getLatestMessageTs();
  const effectiveCursor = !options.fullResync && state.cursorTs > 0 && latestStoredMessageTs > 0
    ? Math.min(state.cursorTs, latestStoredMessageTs)
    : state.cursorTs;
  const cursorWasClamped = effectiveCursor !== state.cursorTs;
  const since = options.fullResync ? 0 : Math.max(effectiveCursor - OVERLAP_SECONDS, 0);

  emit({ type: 'start', cursorTs: state.cursorTs, firstSync: isFirstSync });
  markSyncStarted();

  let messageBuffer: MirrorMessage[] = [];
  let totalInserted = 0;
  let totalSeen = 0;
  let maxTsSeen = effectiveCursor;
  let currentDb: string | null = null;
  const flush = () => {
    if (messageBuffer.length === 0) return;
    const inserted = insertMessages(messageBuffer);
    totalInserted += inserted;
    messageBuffer = [];
    emit({ type: 'progress', messagesInserted: totalInserted, messagesSeen: totalSeen, currentDb });
  };

  let firstError: string | null = null;

  const onLine = (record: unknown) => {
    if (!record || typeof record !== 'object') return;
    const r = record as Record<string, unknown>;
    const recType = String(r.type ?? '');

    if (recType === 'meta') {
      const sessions = Array.isArray(r.sessions) ? r.sessions : [];
      const rows: MirrorSession[] = sessions
        .map((entry) => normalizeSession(entry))
        .filter((s): s is MirrorSession => s !== null);
      const count = upsertSessions(rows);
      emit({ type: 'sessions', count });
      return;
    }

    if (recType === 'db_start') {
      currentDb = typeof r.db === 'string' ? r.db : null;
      const tables = typeof r.tables === 'number' ? r.tables : 0;
      emit({ type: 'db_start', db: currentDb ?? '?', tables });
      return;
    }

    if (recType === 'db_done') {
      flush();
      const db = typeof r.db === 'string' ? r.db : '?';
      const messages = typeof r.messages === 'number' ? r.messages : 0;
      emit({ type: 'db_done', db, messages });
      currentDb = null;
      return;
    }

    if (recType === 'msg') {
      const wxid = typeof r.wxid === 'string' ? r.wxid : null;
      const ts = typeof r.ts === 'number' ? r.ts : null;
      if (!wxid || ts === null || ts <= 0) return;
      messageBuffer.push({
        wxid,
        ts,
        sender: r.sender === 'me' ? 'me' : 'them',
        senderWxid: typeof r.sender_wxid === 'string' ? r.sender_wxid : null,
        senderDisplay: typeof r.sender_display === 'string' ? r.sender_display : null,
        msgType: typeof r.msg_type === 'number' ? r.msg_type : 0,
        content: typeof r.content === 'string' ? r.content : '',
        attachment: normalizeAttachment(r.attachment),
      });
      totalSeen += 1;
      if (ts > maxTsSeen) maxTsSeen = ts;
      if (messageBuffer.length >= FLUSH_THRESHOLD) flush();
      return;
    }

    if (recType === 'done') {
      // Do not trust the Python cursor blindly. Older api.py versions derived
      // it from session summaries, which can be newer than detail rows actually
      // mirrored and would skip unsynced messages on the next incremental run.
      return;
    }

    if (recType === 'error') {
      firstError = typeof r.message === 'string' ? r.message : 'unknown error';
    }
  };

  try {
    const result = await streamWeChatApi(
      'sync_stream',
      { since_timestamp: since },
      { onLine, signal: options.signal },
    );
    flush();
    if (!result.ok) {
      const message = firstError ?? result.error.message;
      setLastError(message);
      emit({ type: 'error', message });
      return {
        status: 'failed',
        inserted: totalInserted,
        seen: totalSeen,
        cursorTs: state.cursorTs,
        durationMs: Date.now() - t0,
        error: message,
      };
    }
  } catch (err) {
    flush();
    const message = err instanceof Error ? err.message : String(err);
    setLastError(message);
    emit({ type: 'error', message });
    return {
      status: 'failed',
      inserted: totalInserted,
      seen: totalSeen,
      cursorTs: state.cursorTs,
      durationMs: Date.now() - t0,
      error: message,
    };
  }

  if (maxTsSeen > state.cursorTs || cursorWasClamped) setCursor(maxTsSeen);
  markSyncFinished(totalInserted);

  const durationMs = Date.now() - t0;
  emit({
    type: 'done',
    messagesInserted: totalInserted,
    messagesSeen: totalSeen,
    cursorTs: maxTsSeen,
    durationMs,
  });

  return {
    status: 'completed',
    inserted: totalInserted,
    seen: totalSeen,
    cursorTs: maxTsSeen,
    durationMs,
  };
}

function normalizeAttachment(input: unknown): WeChatMirrorAttachment | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  if (value.kind !== 'file') return null;
  const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim() : '微信文件';
  return {
    kind: 'file',
    title,
    size: typeof value.size === 'number' && Number.isFinite(value.size) ? value.size : undefined,
    sizeLabel: typeof value.size_label === 'string'
      ? value.size_label
      : typeof value.sizeLabel === 'string'
        ? value.sizeLabel
        : undefined,
    ext: typeof value.ext === 'string' ? value.ext : undefined,
    localPath: typeof value.local_path === 'string'
      ? value.local_path
      : typeof value.localPath === 'string'
        ? value.localPath
        : undefined,
    exists: typeof value.exists === 'boolean' ? value.exists : undefined,
  };
}

function failSkip(
  reason: 'unsupported_platform' | 'consent_required' | 'no_key',
  t0: number,
): SyncResult {
  const state = getSyncState();
  return {
    status: 'skipped',
    reason,
    inserted: 0,
    seen: 0,
    cursorTs: state.cursorTs,
    durationMs: Date.now() - t0,
  };
}

function normalizeSession(entry: unknown): MirrorSession | null {
  if (!entry || typeof entry !== 'object') return null;
  const e = entry as Record<string, unknown>;
  const wxid = typeof e.wxid === 'string' && e.wxid.length > 0 ? e.wxid : null;
  if (!wxid) return null;
  return {
    wxid,
    display: typeof e.display === 'string' ? e.display : '',
    isGroup: !!e.is_group,
    lastTs: typeof e.last_timestamp === 'number' ? e.last_timestamp : 0,
    messageCount: typeof e.message_count === 'number' ? e.message_count : 0,
    unreadCount: typeof e.unread_count === 'number' ? e.unread_count : 0,
    summary: typeof e.summary === 'string' ? e.summary : '',
  };
}
