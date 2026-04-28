'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, Search, MessageSquare, ImageOff } from 'lucide-react';

interface ContactItem {
  wxid: string;
  display: string;
  nickname: string;
  remark: string;
  has_remark: boolean;
}

interface ChatMessage {
  ts: number;
  sender: 'me' | 'them';
  type: number;
  type_label: string;
  content: string;
  has_image?: boolean;
}

interface ContactsResponse {
  items: ContactItem[];
  total: number;
}

interface ChatResponse {
  wxid: string;
  display: string;
  messages: ChatMessage[];
  total: number;
}

const DAY_OPTIONS = [
  { label: '3 天', value: 3 },
  { label: '7 天', value: 7 },
  { label: '30 天', value: 30 },
  { label: '90 天', value: 90 },
];

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

function formatTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

function avatarTone(wxid: string): string {
  // Stable colour from wxid hash so each contact gets a consistent tint.
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

function avatarInitial(display: string): string {
  const trimmed = display.trim();
  if (!trimmed) return '?';
  const first = trimmed.charAt(0);
  if (/[A-Za-z]/.test(first)) return first.toUpperCase();
  return first;
}

// ─────────────────────────────────────────────────────────────────────────
// Contact list
// ─────────────────────────────────────────────────────────────────────────

function ContactList({
  selectedWxid,
  onSelect,
}: {
  selectedWxid: string | null;
  onSelect: (item: ContactItem) => void;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ContactItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      setError(null);
      postQuery<ContactsResponse>('list_contacts', { query, limit: 200 })
        .then((res) => {
          setItems(res.items);
          setTotal(res.total);
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => setLoading(false));
    }, query ? 250 : 0);
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
            placeholder="搜索联系人 / 备注 / 昵称"
            className="w-full h-8 pl-8 pr-3 rounded-md border border-transparent bg-muted/30 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-border focus:bg-background transition-colors"
          />
        </div>
        <div className="px-1 pt-2 text-[11px] text-muted-foreground/70 tabular-nums">
          {loading ? '搜索中…' : `${items.length}${total > items.length ? ` / ${total}` : ''} 个联系人`}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {error ? (
          <div className="m-2 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <span className="text-destructive/90">{error}</span>
          </div>
        ) : items.length === 0 && !loading ? (
          <div className="m-2 text-center text-xs text-muted-foreground/70 pt-6">
            {query ? '没有匹配的联系人' : '没有可显示的联系人'}
          </div>
        ) : (
          items.map((item) => {
            const isActive = item.wxid === selectedWxid;
            return (
              <button
                key={item.wxid}
                type="button"
                onClick={() => onSelect(item)}
                className={`w-full text-left flex items-center gap-2.5 px-2 py-2 rounded-md transition-colors ${
                  isActive ? 'bg-primary/10' : 'hover:bg-muted/60'
                }`}
              >
                <span
                  className={`shrink-0 h-9 w-9 rounded-md flex items-center justify-center text-sm font-medium ${avatarTone(item.wxid)}`}
                >
                  {avatarInitial(item.display)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm truncate text-foreground">{item.display}</span>
                  <span className="block text-[11px] text-muted-foreground/70 truncate">
                    {item.has_remark && item.nickname
                      ? item.nickname
                      : <span className="font-mono">{item.wxid}</span>}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Message timeline
// ─────────────────────────────────────────────────────────────────────────

function MessageTimelineEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center px-10">
      <div className="h-14 w-14 rounded-2xl bg-muted/30 flex items-center justify-center mb-4">
        <MessageSquare className="h-6 w-6 text-muted-foreground/60" />
      </div>
      <div className="text-sm font-medium text-foreground/85">从左侧选择一个联系人</div>
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
            className="text-xs text-foreground/75 px-2.5 py-1.5 rounded-md bg-muted/20 border border-border/30 leading-relaxed"
          >
            {tip}
          </div>
        ))}
      </div>
    </div>
  );
}

type FetchState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: ChatResponse }
  | { kind: 'error'; message: string };

function MessageTimeline({
  contact,
  days,
  setDays,
}: {
  contact: ContactItem;
  days: number;
  setDays: (d: number) => void;
}) {
  // Keyed-mount (parent passes `key={contact.wxid + days}`) means this component
  // freshly initializes on every fetch — so setState only happens in async
  // callbacks, never synchronously inside an effect.
  const [state, setState] = useState<FetchState>({ kind: 'loading' });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    postQuery<ChatResponse>('read_chat', { wxid: contact.wxid, days, limit: 300 })
      .then((res) => { if (!cancelled) setState({ kind: 'ok', data: res }); })
      .catch((err: Error) => { if (!cancelled) setState({ kind: 'error', message: err.message }); });
    return () => { cancelled = true; };
  }, [contact.wxid, days]);

  // Auto-scroll to bottom when new data lands so latest messages are visible.
  useEffect(() => {
    if (state.kind === 'ok' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [state]);

  const grouped = useMemo(() => {
    if (state.kind !== 'ok') return [];
    const groups: { key: string; header: string; items: ChatMessage[] }[] = [];
    let currentKey = '';
    for (const msg of state.data.messages) {
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
      <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 bg-background border-b border-border/40">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className={`shrink-0 h-9 w-9 rounded-md flex items-center justify-center text-sm font-medium ${avatarTone(contact.wxid)}`}
          >
            {avatarInitial(contact.display)}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{contact.display}</div>
            <div className="text-[11px] text-muted-foreground/70 truncate font-mono">{contact.wxid}</div>
          </div>
        </div>
        <div className="flex shrink-0 rounded-md border border-border/40 bg-muted/30 p-0.5">
          {DAY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDays(opt.value)}
              className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                days === opt.value
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
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
        ) : state.data.messages.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground/70 py-12">
            最近 {days} 天没有与 {contact.display} 的消息记录
          </div>
        ) : (
          <div className="space-y-6">
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

// ─────────────────────────────────────────────────────────────────────────
// Bubble
// ─────────────────────────────────────────────────────────────────────────

function MessageBubble({ msg, contact }: { msg: ChatMessage; contact: ContactItem }) {
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
      <span
        className={`shrink-0 h-7 w-7 rounded-md flex items-center justify-center text-xs font-medium ${
          isMe
            ? 'bg-primary/15 text-primary'
            : avatarTone(contact.wxid)
        }`}
      >
        {isMe ? '我' : avatarInitial(contact.display)}
      </span>
      <div className={`flex flex-col max-w-[70%] min-w-0 ${isMe ? 'items-end' : 'items-start'}`}>
        <BubbleBody msg={msg} contact={contact} isMe={isMe} />
        <span className="text-[10px] text-muted-foreground/55 px-1 mt-0.5 tabular-nums">
          {formatTime(msg.ts)}
        </span>
      </div>
    </div>
  );
}

function BubbleBody({ msg, contact, isMe }: { msg: ChatMessage; contact: ContactItem; isMe: boolean }) {
  const meTone = 'bg-primary/15 text-foreground border-primary/15';
  const themTone = 'bg-background border-border/40 text-foreground';

  // Image messages
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

  // Non-text media (voice / video / emoji / app card / location ...)
  if (msg.type !== 1) {
    return (
      <div className={`px-3 py-2 rounded-xl border text-sm text-muted-foreground italic ${isMe ? meTone : themTone}`}>
        {msg.content}
      </div>
    );
  }

  // Plain text
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

// ─────────────────────────────────────────────────────────────────────────

export function WeChatBrowser() {
  const [selected, setSelected] = useState<ContactItem | null>(null);
  const [days, setDays] = useState(7);

  return (
    <div className="flex h-[600px] rounded-lg border border-border/50 overflow-hidden bg-card">
      <div className="w-[280px] shrink-0 border-r border-border/40 bg-muted/15 flex flex-col">
        <ContactList
          selectedWxid={selected?.wxid ?? null}
          onSelect={setSelected}
        />
      </div>
      <div className="flex-1 min-w-0">
        {selected ? (
          <MessageTimeline
            key={`${selected.wxid}-${days}`}
            contact={selected}
            days={days}
            setDays={setDays}
          />
        ) : (
          <MessageTimelineEmpty />
        )}
      </div>
    </div>
  );
}
