'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Loader2, Search, MessageSquare } from 'lucide-react';

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
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · 周${weekday}`;
}

function dateKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

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
      <div className="relative shrink-0 px-3 pt-3">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 mt-1.5 h-3.5 w-3.5 text-muted-foreground/70" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索联系人 / 备注 / 昵称"
          className="w-full h-9 pl-8 pr-3 rounded-md border border-border/40 bg-muted/20 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/40 focus:bg-background transition-colors"
        />
      </div>

      <div className="px-3 pt-2 text-[11px] text-muted-foreground/70 tabular-nums">
        {loading ? '搜索中…' : `${items.length}${total > items.length ? ` / ${total}` : ''} 个联系人`}
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 pt-1 pb-3">
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
                className={`w-full text-left px-2.5 py-2 rounded-md transition-colors group ${
                  isActive
                    ? 'bg-primary/10 text-foreground'
                    : 'hover:bg-muted/60 text-foreground/85'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2 min-w-0">
                  <span className="text-sm truncate font-medium">{item.display}</span>
                  {item.has_remark ? (
                    <span className="text-[10px] text-muted-foreground/70 shrink-0">备注</span>
                  ) : null}
                </div>
                <div className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
                  {item.has_remark && item.nickname ? `昵称 ${item.nickname}` : item.wxid}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

function MessageTimelineEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center px-8">
      <div className="h-12 w-12 rounded-2xl bg-muted/40 flex items-center justify-center mb-3">
        <MessageSquare className="h-5 w-5 text-muted-foreground/60" />
      </div>
      <div className="text-sm text-muted-foreground">从左侧选择一个联系人</div>
      <div className="text-xs text-muted-foreground/70 mt-1.5 leading-relaxed max-w-xs">
        消息只在你这台电脑本地解密。lumos 不会上传任何聊天内容。
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
  // freshly initializes on every fetch trigger — so setState only happens in
  // the async callbacks, never synchronously inside an effect.
  const [state, setState] = useState<FetchState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    postQuery<ChatResponse>('read_chat', { wxid: contact.wxid, days, limit: 300 })
      .then((res) => { if (!cancelled) setState({ kind: 'ok', data: res }); })
      .catch((err: Error) => { if (!cancelled) setState({ kind: 'error', message: err.message }); });
    return () => { cancelled = true; };
  }, [contact.wxid, days]);

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
    <div className="flex h-full flex-col">
      <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-b border-border/30">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{contact.display}</div>
          <div className="text-[11px] text-muted-foreground/70 truncate font-mono">{contact.wxid}</div>
        </div>
        <div className="flex shrink-0 rounded-md border border-border/40 bg-muted/20 p-0.5">
          {DAY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDays(opt.value)}
              className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
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

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {state.kind === 'loading' ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>读取消息中…</span>
          </div>
        ) : state.kind === 'error' ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <div className="text-destructive/90">{state.message}</div>
          </div>
        ) : state.data.messages.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground/70 py-8">
            最近 {days} 天没有与 {contact.display} 的消息记录
          </div>
        ) : (
          <div className="space-y-5">
            {grouped.map((group) => (
              <div key={group.key}>
                <div className="sticky top-0 -mx-5 px-5 py-1 bg-background/95 backdrop-blur text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2">
                  {group.header}
                </div>
                <div className="space-y-2">
                  {group.items.map((msg, idx) => (
                    <MessageRow key={`${msg.ts}-${idx}`} msg={msg} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MessageRow({ msg }: { msg: ChatMessage }) {
  const isMe = msg.sender === 'me';
  const isSystem = msg.type === 10000 || msg.type === 10002;
  const isMedia = msg.type !== 1 && !isSystem;

  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="shrink-0 w-12 text-[11px] text-muted-foreground/60 tabular-nums pt-0.5">
        {formatTime(msg.ts)}
      </span>
      <span
        className={`shrink-0 w-7 text-[11px] pt-0.5 ${
          isSystem ? 'text-muted-foreground/50' : isMe ? 'text-primary/80' : 'text-foreground/65'
        }`}
      >
        {isSystem ? '系统' : isMe ? '我' : '对方'}
      </span>
      <span
        className={`flex-1 leading-relaxed break-words ${
          isSystem
            ? 'text-muted-foreground/70 italic text-xs'
            : isMedia
              ? 'text-muted-foreground'
              : 'text-foreground/90'
        }`}
      >
        {msg.content}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────

export function WeChatBrowser() {
  const [selected, setSelected] = useState<ContactItem | null>(null);
  const [days, setDays] = useState(7);

  return (
    <div className="flex h-[520px] rounded-lg border border-border/50 overflow-hidden bg-card">
      <div className="w-[280px] shrink-0 border-r border-border/30 bg-muted/10">
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

