'use client';

import * as React from 'react';

import type { SyncProgressEvent } from '@/lib/wechat-assistant/sync-engine';

export interface SyncState {
  cursorTs: number;
  lastFinishedAt: number;
  lastError: string | null;
  totalMessages: number;
  firstStartedAt: number;
  inFlight: boolean;
}

export interface UseWeChatSync {
  state: SyncState | null;
  /** Latest progress event from the running sync (null when idle). */
  progress: SyncProgress | null;
  loading: boolean;
  error: string | null;
  /** Has the user ever finished a sync? Drives "first run" UX. */
  hasEverSynced: boolean;
  refresh: () => Promise<void>;
  start: (opts?: { fullResync?: boolean }) => Promise<void>;
}

export interface SyncProgress {
  phase: 'starting' | 'running' | 'done' | 'error';
  messagesInserted: number;
  messagesSeen: number;
  currentDb: string | null;
  /** Most recent meaningful status line. */
  message: string;
  durationMs?: number;
}

const STARTING_MESSAGE = '正在启动同步…';

export function useWeChatSync(): UseWeChatSync {
  const [state, setState] = React.useState<SyncState | null>(null);
  const [progress, setProgress] = React.useState<SyncProgress | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const inFlightRef = React.useRef<AbortController | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch('/api/apps/builtin/wechat/sync', { cache: 'no-store' });
      const json = (await readJson(res)) as { error?: string; message?: string };
      if (!res.ok || !isSyncState(json)) {
        throw new Error(json.message ?? json.error ?? '同步状态加载失败');
      }
      setState(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const start = React.useCallback<UseWeChatSync['start']>(async (opts = {}) => {
    if (inFlightRef.current || state?.inFlight) return; // de-dupe local and backend runs
    const ctrl = new AbortController();
    inFlightRef.current = ctrl;
    setProgress({
      phase: 'starting',
      messagesInserted: 0,
      messagesSeen: 0,
      currentDb: null,
      message: STARTING_MESSAGE,
    });
    setError(null);

    try {
      const res = await fetch('/api/apps/builtin/wechat/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullResync: !!opts.fullResync }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(await readErrorMessage(res, '同步启动失败'));
      }
      await consumeStream(res.body, (event) => {
        setProgress((prev) => applyEvent(prev, event));
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : '同步失败';
      setError(msg);
      setProgress((prev) => ({
        phase: 'error',
        messagesInserted: prev?.messagesInserted ?? 0,
        messagesSeen: prev?.messagesSeen ?? 0,
        currentDb: prev?.currentDb ?? null,
        message: msg,
      }));
    } finally {
      inFlightRef.current = null;
      void refresh();
    }
  }, [refresh, state?.inFlight]);

  const hasEverSynced = !!state && state.lastFinishedAt > 0;
  return { state, progress, loading, error, hasEverSynced, refresh, start };
}

async function consumeStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SyncProgressEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nlIdx = buf.indexOf('\n');
    while (nlIdx !== -1) {
      const line = buf.slice(0, nlIdx).trim();
      buf = buf.slice(nlIdx + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line) as SyncProgressEvent);
        } catch {
          /* skip bad line */
        }
      }
      nlIdx = buf.indexOf('\n');
    }
  }
  if (buf.trim()) {
    try {
      onEvent(JSON.parse(buf.trim()) as SyncProgressEvent);
    } catch { /* ignore */ }
  }
}

function applyEvent(prev: SyncProgress | null, event: SyncProgressEvent): SyncProgress | null {
  switch (event.type) {
    case 'start':
      return {
        phase: 'running',
        messagesInserted: 0,
        messagesSeen: 0,
        currentDb: null,
        message: event.firstSync ? '首次同步中…' : '增量同步中…',
      };
    case 'sessions':
      return {
        phase: 'running',
        messagesInserted: prev?.messagesInserted ?? 0,
        messagesSeen: prev?.messagesSeen ?? 0,
        currentDb: prev?.currentDb ?? null,
        message: `已读取 ${event.count} 个会话`,
      };
    case 'db_start':
      return {
        phase: 'running',
        messagesInserted: prev?.messagesInserted ?? 0,
        messagesSeen: prev?.messagesSeen ?? 0,
        currentDb: event.db,
        message: `正在解码 ${event.db}（${event.tables} 张表）`,
      };
    case 'progress':
      return {
        phase: 'running',
        messagesInserted: event.messagesInserted,
        messagesSeen: event.messagesSeen,
        currentDb: event.currentDb,
        message: `已写入 ${event.messagesInserted.toLocaleString('zh-CN')} 条`,
      };
    case 'db_done':
      return {
        phase: 'running',
        messagesInserted: prev?.messagesInserted ?? 0,
        messagesSeen: prev?.messagesSeen ?? 0,
        currentDb: null,
        message: `${event.db}: ${event.messages.toLocaleString('zh-CN')} 条`,
      };
    case 'done':
      return {
        phase: 'done',
        messagesInserted: event.messagesInserted,
        messagesSeen: event.messagesSeen,
        currentDb: null,
        message: `同步完成 · 新增 ${event.messagesInserted.toLocaleString('zh-CN')} 条`,
        durationMs: event.durationMs,
      };
    case 'error':
      return {
        phase: 'error',
        messagesInserted: prev?.messagesInserted ?? 0,
        messagesSeen: prev?.messagesSeen ?? 0,
        currentDb: prev?.currentDb ?? null,
        message: event.message,
      };
    case 'skipped':
      return {
        phase: 'error',
        messagesInserted: prev?.messagesInserted ?? 0,
        messagesSeen: prev?.messagesSeen ?? 0,
        currentDb: prev?.currentDb ?? null,
        message: skippedHint(event.reason),
      };
    default:
      return null;
  }
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const json = (await readJson(res)) as { error?: string; message?: string };
    return json.message ?? json.error ?? `${fallback}：${res.status}`;
  }
  const text = await res.text().catch(() => '');
  return text.trim() || `${fallback}：${res.status}`;
}

function isSyncState(value: unknown): value is SyncState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<SyncState>;
  return (
    typeof state.cursorTs === 'number'
    && typeof state.lastFinishedAt === 'number'
    && (state.lastError === null || typeof state.lastError === 'string')
    && typeof state.totalMessages === 'number'
    && typeof state.firstStartedAt === 'number'
    && typeof state.inFlight === 'boolean'
  );
}

function skippedHint(reason: 'unsupported_platform' | 'consent_required' | 'no_key' | 'in_progress'): string {
  switch (reason) {
    case 'unsupported_platform':
      return '当前平台暂不支持读取微信消息。';
    case 'consent_required':
      return '请先完成数据授权。';
    case 'no_key':
      return '尚未恢复微信密钥。';
    case 'in_progress':
      return '同步正在进行中…';
  }
}
