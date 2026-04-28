'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AlertCircle, Loader2, Search, MessageSquare, ImageOff } from 'lucide-react';

interface SessionItem {
  wxid: string;
  display: string;
  nickname: string;
  remark: string;
  has_remark: boolean;
  /** Last activity epoch (sessions endpoint only). 0 when from contacts search. */
  last_timestamp?: number;
  summary?: string;
  unread_count?: number;
  is_group?: boolean;
}

interface ChatMessage {
  ts: number;
  sender: 'me' | 'them';
  type: number;
  type_label: string;
  content: string;
  has_image?: boolean;
}

interface ListResponse {
  items: SessionItem[];
  total: number;
}

interface ChatResponse {
  wxid: string;
  display: string;
  messages: ChatMessage[];
  has_more: boolean;
  total: number;
}

async function postQuery<T>(op: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/wechat-export/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ op, args }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof json.message === 'string' ? json.message : (json.error as string) || 'Unknown error';
    throw new Error(msg);
  }
  return json as T;
}

// ─── time / display helpers ──────────────────────────────────────────────

function formatTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatSessionTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) return formatTime(ts);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.getFullYear() === yesterday.getFullYear()
    && d.getMonth() === yesterday.getMonth()
    && d.getDate() === yesterday.getDate();
  if (isYesterday) return '昨天';
  if (d.getFullYear() === now.getFullYear()) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function formatDateHeader(ts: number): string {
  const d = new Date(ts * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(d, today)) return '今天';
  if (sameDay(d, yesterday)) return '昨天';
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  if (d.getFullYear() === today.getFullYear()) {
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${weekday}`;
  }
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${weekday}`;
}

function dateKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function avatarInitial(display: string): string {
  const trimmed = display.trim();
  if (!trimmed) return '?';
  const first = trimmed.charAt(0);
  if (/[A-Za-z]/.test(first)) return first.toUpperCase();
  return first;
}

function avatarTone(wxid: string): string {
  let hash = 0;
  for (let i = 0; i < wxid.length; i++) hash = (hash * 31 + wxid.charCodeAt(i)) >>> 0;
  const tones = [
    'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    'bg-blue-500/15 text-blue-700 dark:text-blue-300',
    'bg-violet-500/15 text-violet-700 dark:text-violet-300',
    'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300',
  ];
  return tones[hash % tones.length];
}

// ─── Avatar component (img with letter fallback) ────────────────────────

function Avatar({ wxid, display, size = 'md' }: { wxid: string; display: string; size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  const dim = size === 'sm' ? 'h-7 w-7 text-[11px]' : size === 'lg' ? 'h-10 w-10 text-sm' : 'h-9 w-9 text-sm';
  const url = `/api/wechat-export/avatar?wxid=${encodeURIComponent(wxid)}`;

  if (failed) {
    return (
      <span
        className={`shrink-0 rounded-md flex items-center justify-center font-medium ${dim} ${avatarTone(wxid)}`}
        aria-hidden
      >
        {avatarInitial(display)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className={`shrink-0 rounded-md object-cover ${dim} bg-muted/30`}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

// ─── Session/contact list (left pane) ────────────────────────────────────

interface ListState {
  items: SessionItem[];
  total: number;
  loading: boolean;
  error: string | null;
}

function SessionList({
  selectedWxid,
  onSelect,
}: {
  selectedWxid: string | null;
  onSelect: (item: SessionItem) => void;
}) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState<ListState>({ items: [], total: 0, loading: true, error: null });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const isSearch = query.trim().length > 0;
    debounceRef.current = setTimeout(() => {
      const op = isSearch ? 'list_contacts' : 'list_sessions';
      const args = isSearch ? { query, limit: 200 } : { limit: 100 };
      postQuery<ListResponse>(op, args)
        .then((res) => setState({ items: res.items, total: res.total, loading: false, error: null }))
        .catch((err: Error) => setState({ items: [], total: 0, loading: false, error: err.message }));
    }, isSearch ? 250 : 0);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-3 pt-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/60" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索全部联系人 / 备注 / 昵称"
            className="w-full h-8 pl-8 pr-3 rounded-md border border-transparent bg-muted/30 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-border focus:bg-background transition-colors"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pb-3">
        {state.error ? (
          <div className="m-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <span className="text-destructive/90">{state.error}</span>
          </div>
        ) : state.loading ? (
          <div className="m-2 flex items-center gap-2 text-xs text-muted-foreground/70 justify-center py-6">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>{query ? '搜索中…' : '加载会话…'}</span>
          </div>
        ) : state.items.length === 0 ? (
          <div className="m-2 text-center text-xs text-muted-foreground/70 pt-6">
            {query ? '没有匹配的联系人' : '暂无最近会话'}
          </div>
        ) : (
          state.items.map((item) => (
            <SessionRow
              key={item.wxid}
              item={item}
              active={item.wxid === selectedWxid}
              onClick={() => onSelect(item)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SessionRow({
  item,
  active,
  onClick,
}: {
  item: SessionItem;
  active: boolean;
  onClick: () => void;
}) {
  const showSummary = !!item.summary && (item.last_timestamp || 0) > 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex items-start gap-2.5 px-2 py-2 rounded-md transition-colors relative ${
        active ? 'bg-primary/10' : 'hover:bg-muted/60'
      }`}
    >
      <Avatar wxid={item.wxid} display={item.display} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm truncate text-foreground flex-1">{item.display}</span>
          {item.last_timestamp ? (
            <span className="shrink-0 text-[10px] text-muted-foreground/65 tabular-nums">
              {formatSessionTime(item.last_timestamp)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="flex-1 text-[11px] text-muted-foreground/70 truncate">
            {showSummary
              ? item.summary
              : item.has_remark && item.nickname
                ? item.nickname
                : <span className="font-mono">{item.wxid}</span>}
          </span>
          {(item.unread_count || 0) > 0 ? (
            <span className="shrink-0 h-4 min-w-4 px-1 rounded-full bg-rose-500 text-white text-[9px] flex items-center justify-center tabular-nums">
              {item.unread_count! > 99 ? '99+' : item.unread_count}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

// ─── Message timeline (right pane) ──────────────────────────────────────

function MessageTimelineEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center px-10 bg-muted/10">
      <div className="h-14 w-14 rounded-2xl bg-background border border-border/40 flex items-center justify-center mb-4">
        <MessageSquare className="h-6 w-6 text-muted-foreground/60" />
      </div>
      <div className="text-sm font-medium text-foreground/85">从左侧选择一个会话</div>
      <div className="text-xs text-muted-foreground mt-2 leading-relaxed max-w-[260px]">
        消息只在你这台 mac 上本地解密。lumos 不上传任何聊天内容,
        除非你主动让 AI 引用其中的片段。
      </div>
      <div className="mt-6 grid w-full max-w-sm gap-1.5 text-left">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 px-2">
          也可以直接问主对话里的 AI
        </div>
        {[
          '读一下我和 X 最近的聊天,有什么待办?',
          '搜一下提到「合同」的所有微信记录',
          '把 X 群本周的内容总结成会议纪要',
        ].map((tip) => (
          <div
            key={tip}
            className="text-xs text-foreground/75 px-2.5 py-1.5 rounded-md bg-background border border-border/30 leading-relaxed"
          >
            {tip}
          </div>
        ))}
      </div>
    </div>
  );
}

// reducer for the chat fetch state machine
type ChatState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; messages: ChatMessage[]; has_more: boolean; loading_more: boolean };

type ChatAction =
  | { type: 'initial_loaded'; messages: ChatMessage[]; has_more: boolean }
  | { type: 'initial_failed'; message: string }
  | { type: 'load_more_start' }
  | { type: 'load_more_done'; messages: ChatMessage[]; has_more: boolean }
  | { type: 'load_more_failed' };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'initial_loaded':
      return { kind: 'ok', messages: action.messages, has_more: action.has_more, loading_more: false };
    case 'initial_failed':
      return { kind: 'error', message: action.message };
    case 'load_more_start':
      return state.kind === 'ok' ? { ...state, loading_more: true } : state;
    case 'load_more_done':
      if (state.kind !== 'ok') return state;
      return {
        kind: 'ok',
        messages: [...action.messages, ...state.messages],
        has_more: action.has_more,
        loading_more: false,
      };
    case 'load_more_failed':
      return state.kind === 'ok' ? { ...state, loading_more: false } : state;
    default:
      return state;
  }
}

function MessageTimeline({ contact }: { contact: SessionItem }) {
  const [state, dispatch] = useReducer(chatReducer, { kind: 'loading' });
  const scrollRef = useRef<HTMLDivElement>(null);
  // Tracks scrollHeight before prepending older messages so we can preserve the
  // user's visual position after the new rows render.
  const preserveAnchor = useRef<{ prevScrollHeight: number; prevScrollTop: number } | null>(null);

  // Initial fetch: latest 50 messages
  useEffect(() => {
    let cancelled = false;
    postQuery<ChatResponse>('read_chat', { wxid: contact.wxid, limit: 50 })
      .then((res) => {
        if (cancelled) return;
        dispatch({ type: 'initial_loaded', messages: res.messages, has_more: res.has_more });
      })
      .catch((err: Error) => {
        if (!cancelled) dispatch({ type: 'initial_failed', message: err.message });
      });
    return () => { cancelled = true; };
  }, [contact.wxid]);

  // After initial load: scroll to bottom (most recent message)
  // After load-more: restore scroll so the user stays at the same content
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || state.kind !== 'ok') return;
    if (preserveAnchor.current) {
      const { prevScrollHeight, prevScrollTop } = preserveAnchor.current;
      el.scrollTop = el.scrollHeight - prevScrollHeight + prevScrollTop;
      preserveAnchor.current = null;
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [state]);

  // Detect scroll-to-top → load older page
  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (state.kind !== 'ok') return;
    if (state.loading_more || !state.has_more) return;
    if (el.scrollTop > 80) return;
    if (state.messages.length === 0) return;
    const oldestTs = state.messages[0].ts;
    preserveAnchor.current = { prevScrollHeight: el.scrollHeight, prevScrollTop: el.scrollTop };
    dispatch({ type: 'load_more_start' });
    postQuery<ChatResponse>('read_chat', { wxid: contact.wxid, before_ts: oldestTs, limit: 50 })
      .then((res) => dispatch({ type: 'load_more_done', messages: res.messages, has_more: res.has_more }))
      .catch(() => dispatch({ type: 'load_more_failed' }));
  };

  const grouped = useMemo(() => {
    if (state.kind !== 'ok') return [];
    const groups: { key: string; header: string; items: ChatMessage[] }[] = [];
    let currentKey = '';
    for (const msg of state.messages) {
      const key = dateKey(msg.ts);
      if (key !== currentKey) {
        groups.push({ key, header: formatDateHeader(msg.ts), items: [] });
        currentKey = key;
      }
      groups[groups.length - 1].items.push(msg);
    }
    return groups;
  }, [state]);

  return (
    <div className="flex h-full flex-col bg-muted/10">
      <div className="shrink-0 flex items-center gap-3 px-5 py-3 bg-background border-b border-border/40">
        <Avatar wxid={contact.wxid} display={contact.display} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate">{contact.display}</div>
          <div className="text-[11px] text-muted-foreground/70 truncate font-mono">{contact.wxid}</div>
        </div>
      </div>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-5 py-4">
        {state.kind === 'loading' ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-12 justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>读取消息中…</span>
          </div>
        ) : state.kind === 'error' ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <div className="text-destructive/90">{state.message}</div>
          </div>
        ) : state.messages.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground/70 py-12">
            没有与 {contact.display} 的消息记录
          </div>
        ) : (
          <div className="space-y-6">
            {state.has_more ? (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground/65 py-2 justify-center">
                {state.loading_more ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>载入更早的消息…</span>
                  </>
                ) : (
                  <span>滚动到顶部加载更多</span>
                )}
              </div>
            ) : (
              <div className="text-center text-[10px] text-muted-foreground/55 py-2">
                · 已到最早 ·
              </div>
            )}
            {grouped.map((group) => (
              <div key={group.key} className="space-y-1.5">
                <div className="flex items-center justify-center mb-2">
                  <span className="text-[10px] text-muted-foreground/65 px-2.5 py-0.5 rounded-full bg-muted/40">
                    {group.header}
                  </span>
                </div>
                {group.items.map((msg, idx) => (
                  <MessageBubble
                    key={`${msg.ts}-${idx}`}
                    msg={msg}
                    contact={contact}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Bubble ──────────────────────────────────────────────────────────────

function MessageBubble({ msg, contact }: { msg: ChatMessage; contact: SessionItem }) {
  const isMe = msg.sender === 'me';
  const isSystem = msg.type === 10000 || msg.type === 10002;

  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <span className="text-[11px] text-muted-foreground/70 italic">
          {msg.content}
        </span>
      </div>
    );
  }

  return (
    <div className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
      <Avatar
        wxid={isMe ? '__self__' : contact.wxid}
        display={isMe ? '我' : contact.display}
        size="sm"
      />
      <div className={`flex flex-col max-w-[70%] min-w-0 ${isMe ? 'items-end' : 'items-start'}`}>
        <BubbleBody msg={msg} contact={contact} isMe={isMe} />
        <span className="text-[10px] text-muted-foreground/55 px-1 mt-0.5 tabular-nums">
          {formatTime(msg.ts)}
        </span>
      </div>
    </div>
  );
}

function BubbleBody({ msg, contact, isMe }: { msg: ChatMessage; contact: SessionItem; isMe: boolean }) {
  const meTone = 'bg-primary/15 text-foreground border-primary/15';
  const themTone = 'bg-background border-border/40 text-foreground';

  if (msg.type === 3) {
    if (msg.has_image) {
      const url = `/api/wechat-export/image?wxid=${encodeURIComponent(contact.wxid)}&ts=${msg.ts}`;
      return (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className={`max-w-full rounded-xl overflow-hidden border ${isMe ? 'border-primary/15' : 'border-border/40'} bg-muted/20 hover:opacity-95 transition-opacity`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="WeChat image"
            className="block max-h-64 w-auto"
            loading="lazy"
          />
        </a>
      );
    }
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${isMe ? meTone : themTone}`}>
        <ImageOff className="h-3.5 w-3.5 text-muted-foreground/70" />
        <span className="text-xs text-muted-foreground">[图片] 本地文件已不存在</span>
      </div>
    );
  }

  if (msg.type !== 1) {
    return (
      <div className={`px-3 py-2 rounded-xl border text-sm text-muted-foreground italic ${isMe ? meTone : themTone}`}>
        {msg.content}
      </div>
    );
  }

  return (
    <div
      className={`px-3 py-2 rounded-xl border text-sm leading-relaxed whitespace-pre-wrap break-words ${
        isMe ? meTone : themTone
      }`}
    >
      {msg.content}
    </div>
  );
}

// ─── Container ───────────────────────────────────────────────────────────

export function WeChatBrowser() {
  const [selected, setSelected] = useState<SessionItem | null>(null);

  return (
    <div className="flex h-[600px] rounded-lg border border-border/50 overflow-hidden bg-card">
      <div className="w-[300px] shrink-0 border-r border-border/40 bg-muted/15 flex flex-col">
        <SessionList
          selectedWxid={selected?.wxid ?? null}
          onSelect={setSelected}
        />
      </div>
      <div className="flex-1 min-w-0">
        {selected ? (
          <MessageTimeline key={selected.wxid} contact={selected} />
        ) : (
          <MessageTimelineEmpty />
        )}
      </div>
    </div>
  );
}
