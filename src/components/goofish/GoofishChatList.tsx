'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatRow, formatRelativeTime, type ChatSessionLite as ChatSession } from './chat-list-utils';

interface Props {
  /** Account filter: a specific unb or 'all' to merge across accounts. */
  account?: string;
  onSelect: (session: ChatSession) => void;
}

/**
 * 微信式会话列表。挂在 GoofishPanel 登录卡片下面。
 *
 * 数据源：本地 SQLite 存档（/api/goofish/sessions），秒开。
 * 后台 5 分钟自动同步一次。手动按钮触发立即全量同步（约 15-30 秒）。
 */
export function GoofishChatList({ onSelect, account = 'all' }: Props) {
  const [sessions, setSessions] = useState<ChatSession[] | null>(null);
  const [lastSyncMs, setLastSyncMs] = useState<number>(0);
  const [intervalMs, setIntervalMs] = useState<number>(60_000);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState('');
  const [locallyRead, setLocallyRead] = useState<Set<string>>(new Set());
  // Tick once a minute so the "X 分钟前" label keeps updating without a refresh.
  const [, setNowTick] = useState(0);

  const loadFromDb = useCallback(async (signal?: AbortSignal) => {
    try {
      const sessUrl = `/api/goofish/sessions?account=${encodeURIComponent(account)}`;
      const [sessRes, syncRes] = await Promise.all([
        fetch(sessUrl, { cache: 'no-store', signal }),
        fetch('/api/goofish/sync', { cache: 'no-store', signal }),
      ]);
      if (signal?.aborted) return;
      const sessData = await sessRes.json();
      const syncData = await syncRes.json();
      if (!sessRes.ok || !sessData?.ok) {
        throw new Error(sessData?.message || `HTTP ${sessRes.status}`);
      }
      // DB row has `cid` (PK) + same fields as ChatSession but the panel
      // expects `session_id`. Adapt keys.
      const mapped: ChatSession[] = (sessData.sessions || []).map((s: ChatSession & { cid: string }) => ({
        ...s,
        session_id: s.session_id || s.cid,
      }));
      setSessions(mapped);
      setLastSyncMs(Number(syncData?.lastSyncMs || 0));
      setIntervalMs(Number(syncData?.intervalMs || 60_000));
      setError(null);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : 'unknown error');
    }
  }, [account]);

  const updateInterval = useCallback(async (ms: number) => {
    setIntervalMs(ms); // optimistic
    try {
      const res = await fetch('/api/goofish/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intervalMs: ms }),
      });
      const data = await res.json();
      if (data?.intervalMs) setIntervalMs(Number(data.intervalMs));
    } catch { /* keep optimistic value, scheduler will read it next tick */ }
  }, []);

  const triggerSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch('/api/goofish/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步失败');
    } finally {
      setSyncing(false);
      void loadFromDb();
    }
  }, [account, loadFromDb]);

  useEffect(() => {
    const ac = new AbortController();
    void loadFromDb(ac.signal);
    return () => ac.abort();
  }, [loadFromDb]);

  // Refresh from DB every 30s so the auto-sync changes show up without
  // the user clicking anything. Cheap — just a SQLite read.
  useEffect(() => {
    const t = setInterval(() => { void loadFromDb(); }, 30_000);
    return () => clearInterval(t);
  }, [loadFromDb]);

  // Re-render once a minute to keep "X 分钟前" labels fresh.
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const filtered = useMemo(() => {
    if (!sessions) return [];
    // Apply locally-read overlay (zero out unread for sessions we've opened).
    const overlaid = sessions.map((s) =>
      locallyRead.has(s.session_id) ? { ...s, unread: 0 } : s,
    );
    const q = query.trim().toLowerCase();
    if (!q) return overlaid;
    return overlaid.filter((s) =>
      s.peer_nick.toLowerCase().includes(q) || s.last_msg.toLowerCase().includes(q),
    );
  }, [sessions, query, locallyRead]);

  if (sessions === null && !error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-1">
        <div className="flex items-center">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          读取本地存档…
        </div>
      </div>
    );
  }

  const empty = sessions !== null && sessions.length === 0 && !syncing;
  if (empty && !lastSyncMs) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-3 text-center px-6">
        <div className="text-sm">本地还没有闲鱼数据</div>
        <div className="text-xs">点下面的按钮做第一次同步（约 15-30 秒）</div>
        <Button size="sm" onClick={() => void triggerSync()} disabled={syncing}>
          {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          {syncing ? '同步中…' : '立即同步'}
        </Button>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-border/60 bg-card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/60 gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-sm">最近会话</h3>
          <p className="text-xs text-muted-foreground truncate">
            {`${sessions?.length ?? 0} 条 · 上次同步 ${formatRelativeTime(lastSyncMs)}`}
            {query && ` · 搜出 ${filtered.length}`}
          </p>
        </div>
        <select
          value={intervalMs}
          onChange={(e) => void updateInterval(Number(e.target.value))}
          className="text-xs bg-muted/30 border-0 rounded px-1.5 py-1 focus:outline-none"
          title="自动同步频率"
        >
          <option value={30_000}>30 秒</option>
          <option value={60_000}>1 分钟</option>
          <option value={5 * 60_000}>5 分钟</option>
          <option value={15 * 60_000}>15 分钟</option>
          <option value={30 * 60_000}>30 分钟</option>
          <option value={60 * 60_000}>1 小时</option>
        </select>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void triggerSync()}
          disabled={syncing}
          title="立即同步闲鱼数据（约 15-30 秒）"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      <div className="relative px-5 py-2 border-b border-border/60">
        <Search className="absolute left-7 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按昵称或消息内容搜索"
          className="w-full pl-7 pr-3 py-1.5 text-sm bg-muted/30 rounded-md focus:outline-none focus:ring-1 focus:ring-primary/30"
        />
      </div>

      {error && (
        <div className="px-5 py-3 text-sm text-red-500 border-b border-border/60">
          拉取失败：{error}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="px-5 py-6 text-sm text-muted-foreground text-center">
          {query ? `没有匹配 "${query}" 的会话` : '暂无会话'}
        </div>
      ) : (
        <ul className="divide-y divide-border/60 overflow-y-auto" style={{ maxHeight: '60vh' }}>
          {filtered.map((s) => (
            <ChatRow
              key={s.session_id}
              session={s}
              onClick={() => {
                setLocallyRead((prev) => {
                  if (prev.has(s.session_id)) return prev;
                  const next = new Set(prev);
                  next.add(s.session_id);
                  return next;
                });
                onSelect(s);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

