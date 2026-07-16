'use client';

// X 私信(只读):左对话列表(收件箱)、右聊天记录。登录过期走统一 XAuthExpiredHint。

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquare, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { XAuthExpiredHint } from './XAuthExpiredHint';

interface Peer { userId: string; name: string; screenName: string; avatar: string }
interface ConvSummary {
  conversationId: string; peer: Peer | null; participantCount: number;
  lastText: string; lastTime: string; lastFromMe: boolean; trusted: boolean;
}
interface DmMsg { id: string; text: string; time: string; fromMe: boolean; senderId: string }

async function fetchXJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && (data as { code?: string })?.code === 'X_AUTH_EXPIRED') throw new Error('X_AUTH_EXPIRED');
  if (!res.ok || !(data as { ok?: boolean })?.ok) throw new Error(String((data as { message?: unknown })?.message || `HTTP ${res.status}`));
  return data as Record<string, unknown>;
}
const isAuthExpired = (e: unknown) => e instanceof Error && e.message === 'X_AUTH_EXPIRED';

function fmtTime(ms: string): string {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n);
  const now = Date.now();
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString();
}

function Avatar({ peer }: { peer: Peer | null }) {
  if (peer?.avatar) {
    // 远程头像,用原生 img 避开 next/image 远程域名配置
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={peer.avatar} alt={peer.name} className="h-9 w-9 rounded-full object-cover shrink-0" />;
  }
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-medium shrink-0">
      {(peer?.name || '?').slice(0, 1)}
    </div>
  );
}

export function XDMSection() {
  const [conversations, setConversations] = useState<ConvSummary[] | null>(null);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [authExpired, setAuthExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DmMsg[] | null>(null);
  const [convLoading, setConvLoading] = useState(false);
  const [activePeer, setActivePeer] = useState<Peer | null>(null);

  const loadInbox = useCallback(async () => {
    setInboxLoading(true); setError(null);
    try {
      const data = await fetchXJson('/api/x/dm/inbox');
      setAuthExpired(false);
      setConversations((data.conversations as ConvSummary[]) ?? []);
    } catch (err) {
      if (isAuthExpired(err)) { setAuthExpired(true); setConversations(null); }
      else setError(err instanceof Error ? err.message : '读取收件箱失败');
    } finally { setInboxLoading(false); }
  }, []);

  useEffect(() => { void loadInbox(); }, [loadInbox]);

  const openConversation = useCallback(async (conv: ConvSummary) => {
    setActiveId(conv.conversationId); setActivePeer(conv.peer); setMessages(null);
    setConvLoading(true); setError(null);
    try {
      const data = await fetchXJson(`/api/x/dm/conversation/${encodeURIComponent(conv.conversationId)}`);
      setAuthExpired(false);
      setMessages((data.messages as DmMsg[]) ?? []);
      if (data.peer) setActivePeer(data.peer as Peer);
    } catch (err) {
      if (isAuthExpired(err)) setAuthExpired(true);
      else setError(err instanceof Error ? err.message : '读取会话失败');
    } finally { setConvLoading(false); }
  }, []);

  if (authExpired) {
    return <div className="space-y-3"><XAuthExpiredHint /><Button size="sm" variant="outline" onClick={() => void loadInbox()}>重试</Button></div>;
  }

  return (
    <div className="flex h-[520px] gap-3">
      {/* 左:对话列表 */}
      <div className="flex w-64 shrink-0 flex-col rounded-lg border border-border/60">
        <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
          <span className="text-xs font-semibold">收件箱</span>
          <button onClick={() => void loadInbox()} className="text-muted-foreground hover:text-foreground" title="刷新">
            <RefreshCw className={`h-3.5 w-3.5 ${inboxLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {inboxLoading && !conversations && <div className="p-4 text-center text-xs text-muted-foreground"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></div>}
          {conversations?.length === 0 && <div className="p-4 text-center text-xs text-muted-foreground">没有私信会话</div>}
          {conversations?.map((c) => (
            <button
              key={c.conversationId}
              onClick={() => void openConversation(c)}
              className={`flex w-full items-center gap-2 border-b border-border/30 px-3 py-2 text-left hover:bg-accent/50 ${activeId === c.conversationId ? 'bg-accent' : ''}`}
            >
              <Avatar peer={c.peer} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-medium">{c.peer?.name || (c.participantCount > 2 ? '群聊' : '未知')}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{fmtTime(c.lastTime)}</span>
                </div>
                <div className="truncate text-[11px] text-muted-foreground">{c.lastFromMe ? '我: ' : ''}{c.lastText || '(无文本)'}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 右:聊天记录 */}
      <div className="flex flex-1 flex-col rounded-lg border border-border/60">
        {!activeId ? (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
            <div className="text-center"><MessageSquare className="mx-auto mb-2 h-8 w-8 opacity-40" />选一个会话查看私信记录</div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
              <Avatar peer={activePeer} />
              <div className="min-w-0">
                <div className="truncate text-xs font-medium">{activePeer?.name || '会话'}</div>
                {activePeer?.screenName && <div className="truncate text-[10px] text-muted-foreground">@{activePeer.screenName}</div>}
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {convLoading && <div className="text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" /></div>}
              {messages?.length === 0 && !convLoading && <div className="text-center text-xs text-muted-foreground">没有消息</div>}
              {messages?.map((m) => (
                <div key={m.id} className={`flex ${m.fromMe ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-lg px-3 py-1.5 text-xs ${m.fromMe ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                    <div className="whitespace-pre-wrap break-words">{m.text || '(无文本)'}</div>
                    <div className={`mt-0.5 text-[9px] ${m.fromMe ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>{fmtTime(m.time)}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {error && <div className="absolute text-xs text-red-500">{error}</div>}
    </div>
  );
}
