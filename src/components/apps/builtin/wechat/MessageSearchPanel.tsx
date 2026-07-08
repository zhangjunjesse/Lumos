'use client';

import * as React from 'react';
import { AlertCircle, Download, Loader2, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { displayWechatName, safeSanitizedWechatText } from './display-helpers';
import { PanelBlock } from './PanelBlock';
import { formatDateTime } from './wechat-types';

type SearchScope = 'all' | 'personal' | 'group';
type SearchSender = 'all' | 'me' | 'them';
type SearchDays = '30' | '90' | '365' | 'all';

interface SearchResult {
  wxid: string;
  display: string;
  isGroup: boolean;
  ts: number;
  sender: 'me' | 'them';
  senderDisplay?: string | null;
  content: string;
}

interface SearchResponse {
  query: string;
  scope: SearchScope;
  sender: SearchSender;
  days: number | 'all';
  from?: string;
  to?: string;
  results: SearchResult[];
  error?: string;
}

interface SearchContext {
  wxid: string;
  display: string;
  isGroup: boolean;
  targetTs: number;
  messages: SearchResult[];
}

const SCOPE_OPTIONS: Array<{ value: SearchScope; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'personal', label: '私聊' },
  { value: 'group', label: '群聊' },
];

const SENDER_OPTIONS: Array<{ value: SearchSender; label: string }> = [
  { value: 'all', label: '全部发送者' },
  { value: 'me', label: '我发送' },
  { value: 'them', label: '对方发送' },
];

const DAYS_OPTIONS: Array<{ value: SearchDays; label: string }> = [
  { value: '90', label: '近 90 天' },
  { value: '30', label: '近 30 天' },
  { value: '365', label: '近 1 年' },
  { value: 'all', label: '全部历史' },
];

export interface MessageSearchRequest {
  id: number;
  query: string;
}

export function MessageSearchPanel({
  searchRequest,
}: {
  searchRequest?: MessageSearchRequest | null;
}): React.ReactElement {
  const [query, setQuery] = React.useState('');
  const [scope, setScope] = React.useState<SearchScope>('all');
  const [sender, setSender] = React.useState<SearchSender>('all');
  const [days, setDays] = React.useState<SearchDays>('90');
  const [fromDate, setFromDate] = React.useState('');
  const [toDate, setToDate] = React.useState('');
  const [results, setResults] = React.useState<SearchResult[]>([]);
  const [searchedQuery, setSearchedQuery] = React.useState('');
  const [hasRunSearch, setHasRunSearch] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [contextOpen, setContextOpen] = React.useState(false);
  const [context, setContext] = React.useState<SearchContext | null>(null);
  const [contextLoading, setContextLoading] = React.useState(false);
  const [contextError, setContextError] = React.useState<string | null>(null);
  const searchLoadingRef = React.useRef(false);
  const handledSearchRequestIdRef = React.useRef<number | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  const runSearch = React.useCallback(async (
    text: string,
    nextScope: SearchScope,
    nextSender: SearchSender,
    nextDays: SearchDays,
    nextFromDate: string,
    nextToDate: string,
  ) => {
    if ((!text && nextSender === 'all') || searchLoadingRef.current) return;
    searchLoadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        q: text,
        scope: nextScope,
        sender: nextSender,
        days: nextDays,
        limit: '50',
      });
      if (nextFromDate) params.set('from', nextFromDate);
      if (nextToDate) params.set('to', nextToDate);
      const res = await fetch(`/api/apps/builtin/wechat/search?${params.toString()}`, {
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => ({}))) as Partial<SearchResponse> & { message?: string };
      if (!res.ok || !Array.isArray(json.results)) {
        throw new Error(json.message ?? json.error ?? '搜索失败');
      }
      setResults(json.results.filter(isSearchResult));
      setSearchedQuery(typeof json.query === 'string' && json.query.trim() ? json.query : text);
      setHasRunSearch(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败');
      setResults([]);
      setSearchedQuery(text);
      setHasRunSearch(true);
    } finally {
      searchLoadingRef.current = false;
      setLoading(false);
    }
  }, []);

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const text = query.trim();
    await runSearch(text, scope, sender, days, fromDate, toDate);
  };

  React.useEffect(() => {
    const text = searchRequest?.query.trim();
    if (!text) return;
    if (handledSearchRequestIdRef.current === searchRequest?.id) return;
    handledSearchRequestIdRef.current = searchRequest?.id ?? null;
    setQuery(text);
    setScope('all');
    setSender('all');
    setDays('all');
    setFromDate('');
    setToDate('');
    void runSearch(text, 'all', 'all', 'all', '', '');
    window.requestAnimationFrame(() => {
      panelRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  }, [runSearch, searchRequest?.id, searchRequest?.query]);

  const hasSearched = hasRunSearch;
  const canSearch = !!query.trim() || sender !== 'all';

  const exportMyMessages = React.useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        scope,
        sender: 'me',
      });
      if (fromDate) params.set('from', fromDate);
      if (toDate) params.set('to', toDate);
      const res = await fetch(`/api/apps/builtin/wechat/search/export?${params.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(json.message ?? json.error ?? '导出失败');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = exportFilename(fromDate, toDate);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }, [exporting, fromDate, scope, toDate]);

  const openContext = React.useCallback(async (item: SearchResult) => {
    setContextOpen(true);
    setContext(null);
    setContextLoading(true);
    setContextError(null);
    try {
      const params = new URLSearchParams({
        wxid: item.wxid,
        ts: String(item.ts),
        radius: '8',
      });
      const res = await fetch(`/api/apps/builtin/wechat/search/context?${params.toString()}`, {
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => ({}))) as { context?: unknown; error?: string; message?: string };
      if (!res.ok || !isSearchContext(json.context)) {
        throw new Error(json.message ?? json.error ?? '上下文加载失败');
      }
      setContext(json.context);
    } catch (err) {
      setContextError(err instanceof Error ? err.message : '上下文加载失败');
    } finally {
      setContextLoading(false);
    }
  }, []);

  const closeContext = React.useCallback(() => {
    setContextOpen(false);
    setContext(null);
    setContextError(null);
    setContextLoading(false);
  }, []);

  return (
    <div ref={panelRef} className="scroll-mt-6">
      <PanelBlock
        title="聊天记录搜索"
        description="直接检索本机已同步的微信消息，不发送给 AI。"
        right={hasSearched ? `${results.length} 条结果` : undefined}
      >
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
          <form className="grid gap-2 xl:grid-cols-[minmax(220px,1fr)_120px_132px_132px_128px_128px_auto_auto]" onSubmit={(event) => void submit(event)}>
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索联系人、项目、金额、承诺或任意关键词"
                className="pl-8"
              />
            </div>
            <Select value={scope} onValueChange={(value) => setScope(value as SearchScope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPE_OPTIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sender} onValueChange={(value) => setSender(value as SearchSender)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SENDER_OPTIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={days} onValueChange={(value) => setDays(value as SearchDays)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS_OPTIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              aria-label="起始日期"
              className="text-xs"
            />
            <Input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              aria-label="结束日期"
              className="text-xs"
            />
            <Button type="submit" disabled={!canSearch || loading}>
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
              搜索
            </Button>
            <Button type="button" variant="outline" disabled={exporting} onClick={() => void exportMyMessages()}>
              {exporting ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              导出全部我发送
            </Button>
          </form>

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          {hasSearched && !loading && results.length === 0 && !error ? (
            <div className="rounded-md border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
              没有找到匹配的消息。
            </div>
          ) : null}

          {results.length > 0 ? (
            <div className="flex max-h-80 flex-col overflow-y-auto rounded-md border">
              {results.map((item, index) => (
                <SearchResultRow
                  key={`${item.wxid}-${item.ts}-${index}`}
                  item={item}
                  query={searchedQuery}
                  first={index === 0}
                  onOpenContext={() => void openContext(item)}
                />
              ))}
            </div>
          ) : null}
        </div>

        <SearchContextDialog
          open={contextOpen}
          loading={contextLoading}
          error={contextError}
          context={context}
          onOpenChange={(open) => {
            if (!open) closeContext();
          }}
        />
      </PanelBlock>
    </div>
  );
}

function SearchResultRow({
  item,
  query,
  first,
  onOpenContext,
}: {
  item: SearchResult;
  query: string;
  first: boolean;
  onOpenContext: () => void;
}) {
  return (
    <div className={cn('flex flex-col gap-1 px-3 py-2.5 text-sm', !first && 'border-t')}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="min-w-0 truncate font-medium">
          {displayWechatName(item.display, item.wxid, {
            groupFallback: '微信群聊',
            contactFallback: '微信联系人',
          })}
        </span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {item.isGroup ? '群聊' : '私聊'}
        </span>
        <span className="text-[11px] text-muted-foreground">
          {senderLabel(item, item.isGroup, true)}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {formatDateTime(item.ts * 1000)}
        </span>
      </div>
      <p className="min-w-0 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
        {snippetFor(item.content, query)}
      </p>
      <div className="flex items-center justify-end">
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onOpenContext}>
          查看上下文
        </Button>
      </div>
    </div>
  );
}

function snippetFor(content: string, query: string): string {
  const text = safeSanitizedWechatText(content, '消息内容已隐藏').replace(/\s+/g, ' ').trim();
  const needle = query.trim();
  if (!needle) return text.slice(0, 180);
  const index = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return trimWithEllipsis(text, 0, 180);
  const start = Math.max(0, index - 50);
  return trimWithEllipsis(text, start, 180);
}

function trimWithEllipsis(value: string, start: number, length: number): string {
  const prefix = start > 0 ? '...' : '';
  const body = value.slice(start, start + length);
  const suffix = start + length < value.length ? '...' : '';
  return `${prefix}${body}${suffix}`;
}

function exportFilename(fromDate: string, toDate: string): string {
  const range = fromDate || toDate ? `${fromDate || 'start'}_${toDate || 'end'}` : 'all';
  return `wechat-my-messages-${range}.csv`;
}

function SearchContextDialog({
  open,
  loading,
  error,
  context,
  onOpenChange,
}: {
  open: boolean;
  loading: boolean;
  error: string | null;
  context: SearchContext | null;
  onOpenChange: (open: boolean) => void;
}) {
  const summary = context
    ? `${context.isGroup ? '群聊' : '私聊'} · ${displayWechatName(context.display, context.wxid, {
      groupFallback: '微信群聊',
      contactFallback: '微信联系人',
    })} · ${formatDateTime(context.targetTs * 1000)}`
    : '聊天上下文';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex max-h-[85vh] w-[min(760px,calc(100vw-2rem))] flex-col gap-4 overflow-hidden sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="truncate text-base">{summary}</DialogTitle>
          <DialogDescription>命中消息前后上下文</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            正在加载上下文…
          </div>
        ) : null}

        {error ? (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        {context ? (
          <div className="max-h-[60vh] overflow-y-auto rounded-md border">
            {context.messages.length > 0 ? (
              context.messages.map((message, index) => (
                <div
                  key={`${message.ts}-${index}`}
                  className={cn('flex flex-col gap-1 px-3 py-2.5 text-sm', index > 0 && 'border-t')}
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px]', message.sender === 'me' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground')}>
                      {senderLabel(message, context.isGroup, false)}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {formatDateTime(message.ts * 1000)}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-xs leading-5">
                    {safeSanitizedWechatText(message.content, '消息内容已隐藏')}
                  </p>
                </div>
              ))
            ) : (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">暂无上下文。</div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function senderLabel(
  message: { sender: 'me' | 'them'; senderDisplay?: string | null },
  isGroup: boolean,
  actionLabel: boolean,
): string {
  if (message.sender === 'me') return actionLabel ? '我发送' : '我';
  if (isGroup && message.senderDisplay) {
    const name = displayWechatName(message.senderDisplay, null, { contactFallback: '群成员' });
    return actionLabel ? `${name}发送` : name;
  }
  return actionLabel ? '对方发送' : isGroup ? '群成员' : '对方';
}

function isSearchResult(value: unknown): value is SearchResult {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<SearchResult>;
  return (
    typeof item.wxid === 'string'
    && typeof item.display === 'string'
    && typeof item.isGroup === 'boolean'
    && typeof item.ts === 'number'
    && (item.sender === 'me' || item.sender === 'them')
    && (item.senderDisplay === undefined || item.senderDisplay === null || typeof item.senderDisplay === 'string')
    && typeof item.content === 'string'
  );
}

function isSearchContext(value: unknown): value is SearchContext {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<SearchContext>;
  return (
    typeof context.wxid === 'string'
    && typeof context.display === 'string'
    && typeof context.isGroup === 'boolean'
    && typeof context.targetTs === 'number'
    && Array.isArray(context.messages)
    && context.messages.every(isSearchResult)
  );
}
