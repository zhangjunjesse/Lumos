'use client';
/* eslint-disable @next/next/no-img-element -- 闲鱼远程 CDN 图片需要 referrerPolicy=no-referrer */

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, RefreshCw, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GoofishAvatar } from './GoofishAvatar';

interface ChatSession {
  session_id: string;
  peer_nick: string;
  peer_user_id?: string;
  peer_avatar?: string;
  unread: number;
}

type Content =
  | { kind: 'text'; text: string }
  | { kind: 'image'; url: string; width: number; height: number }
  | { kind: 'item'; itemId: string; price: string; title: string; mainPic: string; tip?: string }
  | { kind: 'system'; text: string }
  | { kind: 'unknown'; raw: string };

interface ChatMessage {
  messageId: string;
  fromUserId: string;
  fromUserName: string;
  createdAt: number;
  readStatus: number;
  summary?: string;
  content: Content;
}

interface Props {
  session: ChatSession;
  myUserId: string;
  onBack: () => void;
}

/** 单条会话的消息历史 + 输入框，微信式气泡布局，自动滚到底。 */
export function GoofishChatDetail({ session, myUserId, onBack }: Props) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomAnchor = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/goofish/messages/${session.session_id}`, { cache: 'no-store', signal });
      const data = await res.json();
      if (signal?.aborted) return;
      if (!res.ok || !data?.ok) throw new Error(data?.message || `HTTP ${res.status}`);
      setMessages(data.messages || []);
      setError(null);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : 'unknown error');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [session.session_id]);

  // Manual refresh button — uncancellable, user-initiated.
  const refresh = useCallback(() => fetchMessages(), [fetchMessages]);

  const send = useCallback(async () => {
    const text = draft.trim();
    const toid = session.peer_user_id;
    if (!text || !toid || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/goofish/messages/${session.session_id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toid, text }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.message || `HTTP ${res.status}`);
      setDraft('');
      // Re-fetch so the sent message appears (it'll come back via the WS path).
      void fetchMessages();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  }, [draft, session.peer_user_id, session.session_id, sending, fetchMessages]);

  useEffect(() => {
    const ac = new AbortController();
    void fetchMessages(ac.signal);
    return () => ac.abort();
  }, [fetchMessages]);

  useEffect(() => {
    if (!messages || !bottomAnchor.current) return;
    // Scroll on next frame so any image bubbles have a chance to commit
    // their height first; otherwise we land short of the actual bottom.
    const r = requestAnimationFrame(() => {
      bottomAnchor.current?.scrollIntoView({ block: 'end' });
    });
    return () => cancelAnimationFrame(r);
  }, [messages]);

  return (
    <section
      className="rounded-xl border border-border/60 bg-card overflow-hidden flex flex-col"
      // Cap height so the bottom (input + latest messages) stays inside the
      // viewport even when the panel is scrolled all the way down. ~16rem of
      // headroom = login card + account chips above us + page padding.
      style={{ height: 'min(70vh, calc(100vh - 16rem))', minHeight: '420px' }}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/60 shrink-0">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm truncate">{session.peer_nick || '会话'}</div>
        </div>
        <Button variant="ghost" size="icon" onClick={refresh} disabled={loading} className="h-8 w-8">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-muted/10">
        {messages === null && !error && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> 加载消息中…
          </div>
        )}
        {error && (
          <div className="text-sm text-red-500">拉取失败：{error}</div>
        )}
        {messages && messages.length === 0 && !error && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-xs text-center px-6">
            <div>
              <div className="mb-1">没有可显示的消息</div>
              <div className="text-[11px]">系统通知（系统消息 / 卖家小助手等）的历史无法通过 API 拉取，<br />闲鱼把它们走的是另一条接口。</div>
            </div>
          </div>
        )}
        {(() => {
          if (!messages) return null;
          // Sort oldest → newest so newest sits at the bottom (WeChat-style).
          const sorted = [...messages].sort((a, b) => a.createdAt - b.createdAt);
          const out: ReactNode[] = [];
          let lastTs = 0;
          sorted.forEach((m, i) => {
            // Show a time separator when gap > 5 minutes, or before the first.
            if (m.createdAt && m.createdAt - lastTs > 5 * 60_000) {
              out.push(
                <div key={`t-${i}`} className="flex justify-center my-2">
                  <span className="text-[11px] text-muted-foreground">{formatBubbleTime(m.createdAt)}</span>
                </div>,
              );
              lastTs = m.createdAt;
            }
            out.push(
              <MessageBubble key={i} message={m} fromMe={m.fromUserId === myUserId} />,
            );
          });
          return out;
        })()}
        <div ref={bottomAnchor} />
      </div>

      {session.peer_user_id ? (
        <div className="border-t border-border/60 px-3 py-2 shrink-0 bg-card">
          {sendError && (
            <div className="text-xs text-red-500 px-1 pb-1">发送失败：{sendError}</div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter 发送，Shift+Enter 换行（微信式）
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              rows={1}
              disabled={sending}
              className="flex-1 resize-none text-sm bg-muted/30 rounded-md px-3 py-2 max-h-32 focus:outline-none focus:ring-1 focus:ring-primary/30"
            />
            <Button size="sm" onClick={() => void send()} disabled={sending || !draft.trim()}>
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      ) : (
        <div className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground shrink-0 text-center bg-card">
          缺少对方 ID，无法发送消息
        </div>
      )}
    </section>
  );
}

function MessageBubble({ message, fromMe }: { message: ChatMessage; fromMe: boolean }) {
  const c = message.content;

  // 系统提示居中，不显示头像、不显示时间
  if (c.kind === 'system') {
    return (
      <div className="flex justify-center my-2">
        <div className="text-[11px] text-muted-foreground bg-muted/40 px-3 py-1 rounded-full max-w-[80%] text-center">
          {c.text}
        </div>
      </div>
    );
  }

  const time = message.createdAt ? formatBubbleTime(message.createdAt) : '';
  // readStatus: 1 = read by peer, 2 = sent but not yet read. Only render
  // the ticks for messages I sent (peer's incoming readStatus is irrelevant).
  const readMark = fromMe && message.readStatus === 1 ? '已读' : (fromMe && message.readStatus === 2 ? '未读' : '');

  return (
    <div className={`flex gap-2 items-end ${fromMe ? 'justify-end' : 'justify-start'}`}>
      {!fromMe && <GoofishAvatar userId={message.fromUserId} name={message.fromUserName} size={32} />}
      <div className={`flex flex-col gap-0.5 max-w-[70%] ${fromMe ? 'items-end' : 'items-start'}`}>
        <BubbleContent content={c} fromMe={fromMe} />
        {(time || readMark) && (
          <div className="text-[10px] text-muted-foreground px-1 flex gap-1.5">
            {time && <span>{time}</span>}
            {readMark && <span className={readMark === '已读' ? 'text-blue-500' : ''}>{readMark}</span>}
          </div>
        )}
      </div>
      {fromMe && <GoofishAvatar userId={message.fromUserId} name={message.fromUserName} size={32} />}
    </div>
  );
}

function BubbleContent({ content: c, fromMe }: { content: Content; fromMe: boolean }) {
  const bubble = fromMe ? 'bg-blue-500 text-white' : 'bg-card border border-border/60';
  if (c.kind === 'text') {
    return (
      <div className={`${bubble} px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words`}>
        {c.text}
      </div>
    );
  }
  if (c.kind === 'image') {
    return (
      <div className={`${bubble} p-1 rounded-xl overflow-hidden`}>
        {c.url ? (
          <img src={c.url} alt="" referrerPolicy="no-referrer" className="rounded-lg max-h-64 w-auto" />
        ) : (
          <div className="px-3 py-2 text-sm">[图片]</div>
        )}
      </div>
    );
  }
  if (c.kind === 'item') {
    return (
      <div className={`${bubble} p-2 rounded-xl flex gap-2`}>
        {c.mainPic && (
          <img src={c.mainPic} alt="" referrerPolicy="no-referrer" className="h-16 w-16 rounded object-cover shrink-0" />
        )}
        <div className="min-w-0 flex flex-col justify-between">
          {c.tip && <div className="text-xs opacity-80">{c.tip}</div>}
          <div className="text-sm truncate">{c.title || '(商品)'}</div>
          <div className="text-sm font-medium">{c.price}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={`${bubble} px-3 py-2 rounded-xl text-xs italic opacity-70`}>
      [不支持的消息类型]
    </div>
  );
}

function formatBubbleTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const yd = new Date(now); yd.setDate(now.getDate() - 1);
  if (d.getFullYear() === yd.getFullYear() && d.getMonth() === yd.getMonth() && d.getDate() === yd.getDate()) {
    return `昨天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (d.getFullYear() === now.getFullYear()) {
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
