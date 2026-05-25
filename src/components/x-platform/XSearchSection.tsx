'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  MessageSquareText,
  Search,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { XAuthExpiredHint } from './XAuthExpiredHint';

interface Hit {
  id: string;
  authorScreenName: string;
  authorName: string;
  text: string;
  createdAt: number;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  url: string;
}

interface SearchMeta {
  requestedCount?: number;
  returnedCount?: number;
  maxSupportedCount?: number;
  partial?: boolean;
  timedOut?: boolean;
  durationMs?: number;
  error?: string;
}

interface ThreadResult {
  tweet: Hit | null;
  conversationId: string;
  replies: Hit[];
  meta: SearchMeta;
}

type XSubTab = 'search' | 'user' | 'thread';

const COLLECT_COUNT_OPTIONS = [20, 50, 100, 200, 500, 1000];
const REPLY_COUNT_OPTIONS = [20, 50, 100, 200, 500];
const PAGE_SIZE_OPTIONS = [10, 20, 50];

export function XSearchSection() {
  const [tab, setTab] = useState<XSubTab>('search');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [userScreenName, setUserScreenName] = useState('');
  const [userAutoSearchKey, setUserAutoSearchKey] = useState(0);
  const [tweetIdOrUrl, setTweetIdOrUrl] = useState('');
  const [threadAutoSearchKey, setThreadAutoSearchKey] = useState(0);

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      window.setTimeout(() => setCopiedUrl((current) => (current === url ? null : current)), 1600);
    } catch {
      setCopiedUrl(null);
    }
  };

  const openUserTweets = (screenName: string) => {
    const normalized = screenName.trim().replace(/^@/, '');
    if (!normalized) return;
    setUserScreenName(normalized);
    setUserAutoSearchKey((key) => key + 1);
    setTab('user');
  };

  const openTweetDetail = (hit: Hit) => {
    const target = hit.url || hit.id;
    if (!target) return;
    setTweetIdOrUrl(target);
    setThreadAutoSearchKey((key) => key + 1);
    setTab('thread');
  };

  return (
    <section className="rounded-xl border border-border/60 bg-card p-4">
      <Tabs value={tab} onValueChange={(value) => setTab(value as XSubTab)} className="gap-4">
        <TabsList>
          <TabsTrigger value="search">
            <Search className="h-3.5 w-3.5" />
            关键词搜索
          </TabsTrigger>
          <TabsTrigger value="user">
            <UserRound className="h-3.5 w-3.5" />
            用户推文
          </TabsTrigger>
          <TabsTrigger value="thread">
            <MessageSquareText className="h-3.5 w-3.5" />
            推文详情
          </TabsTrigger>
        </TabsList>

        <TabsContent value="search" forceMount className="space-y-3 data-[state=inactive]:hidden">
          <SearchTab
            copiedUrl={copiedUrl}
            onCopyUrl={copyUrl}
            onOpenTweet={openTweetDetail}
            onOpenUser={openUserTweets}
          />
        </TabsContent>
        <TabsContent value="user" forceMount className="space-y-3 data-[state=inactive]:hidden">
          <UserTweetsTab
            autoSearchKey={userAutoSearchKey}
            copiedUrl={copiedUrl}
            screenName={userScreenName}
            onCopyUrl={copyUrl}
            onOpenTweet={openTweetDetail}
            onOpenUser={openUserTweets}
            onScreenNameChange={setUserScreenName}
          />
        </TabsContent>
        <TabsContent value="thread" forceMount className="space-y-3 data-[state=inactive]:hidden">
          <ThreadTab
            autoSearchKey={threadAutoSearchKey}
            copiedUrl={copiedUrl}
            tweetIdOrUrl={tweetIdOrUrl}
            onCopyUrl={copyUrl}
            onOpenTweet={openTweetDetail}
            onOpenUser={openUserTweets}
            onTweetIdOrUrlChange={setTweetIdOrUrl}
          />
        </TabsContent>
      </Tabs>
    </section>
  );
}

function SearchTab({
  copiedUrl,
  onCopyUrl,
  onOpenTweet,
  onOpenUser,
}: {
  copiedUrl: string | null;
  onCopyUrl: (url: string) => Promise<void>;
  onOpenTweet: (hit: Hit) => void;
  onOpenUser: (screenName: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [meta, setMeta] = useState<SearchMeta | null>(null);
  const [collectCount, setCollectCount] = useState(50);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authExpired, setAuthExpired] = useState(false);

  const runSearch = async (overrideCount?: number) => {
    const q = query.trim();
    const targetCount = overrideCount ?? collectCount;
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q, maxCount: String(targetCount) });
      if (targetCount > 50) params.set('partial', '1');
      const data = await fetchXJson(`/api/x/search?${params.toString()}`);
      setAuthExpired(false);
      setHits(readHits(data.hits));
      setMeta(readCollectionMeta(data));
      setPage(1);
    } catch (err) {
      if (isAuthExpiredError(err)) {
        setAuthExpired(true);
        setHits(null);
        setMeta(null);
      } else {
        setError(err instanceof Error ? err.message : '搜索失败');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SearchInput
        icon={<Search className="h-4 w-4" />}
        loading={loading}
        onSubmit={() => void runSearch()}
        placeholder="搜索 X 上的推文，支持 from:elonmusk since:2026-01-01"
        submitLabel="搜索"
        value={query}
        onChange={setQuery}
      />
      <CollectionControls
        collectCount={collectCount}
        collectOptions={COLLECT_COUNT_OPTIONS}
        hits={hits}
        meta={meta}
        pageSize={pageSize}
        onCollectCountChange={setCollectCount}
        onPageSizeChange={(value) => {
          setPageSize(value);
          setPage(1);
        }}
      />
      <ResultState authExpired={authExpired} error={error} meta={meta} empty={hits?.length === 0 && !loading} />
      {hits && (
        <TweetList
          copiedUrl={copiedUrl}
          hits={hits}
          nextCollectCount={COLLECT_COUNT_OPTIONS.find((count) => count > collectCount)}
          page={page}
          pageSize={pageSize}
          onCopyUrl={onCopyUrl}
          onOpenTweet={onOpenTweet}
          onOpenUser={onOpenUser}
          onPageChange={setPage}
          onRequestMore={(count) => {
            setCollectCount(count);
            void runSearch(count);
          }}
        />
      )}
    </>
  );
}

function UserTweetsTab({
  autoSearchKey,
  copiedUrl,
  onCopyUrl,
  onOpenTweet,
  onOpenUser,
  onScreenNameChange,
  screenName,
}: {
  autoSearchKey: number;
  copiedUrl: string | null;
  onCopyUrl: (url: string) => Promise<void>;
  onOpenTweet: (hit: Hit) => void;
  onOpenUser: (screenName: string) => void;
  onScreenNameChange: (screenName: string) => void;
  screenName: string;
}) {
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [meta, setMeta] = useState<SearchMeta | null>(null);
  const [collectCount, setCollectCount] = useState(200);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const consumedAutoSearchKeyRef = useRef(0);

  const runUserTweets = useCallback(async (overrideCount?: number, overrideScreenName?: string) => {
    const screen = (overrideScreenName ?? screenName).trim().replace(/^@/, '');
    const targetCount = overrideCount ?? collectCount;
    if (!screen || loading) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ screen, maxCount: String(targetCount) });
      if (targetCount > 50) params.set('partial', '1');
      const data = await fetchXJson(`/api/x/timeline?${params.toString()}`);
      setAuthExpired(false);
      setHits(readHits(data.hits));
      setMeta(readCollectionMeta(data));
      setPage(1);
    } catch (err) {
      if (isAuthExpiredError(err)) {
        setAuthExpired(true);
        setHits(null);
        setMeta(null);
      } else {
        setError(err instanceof Error ? err.message : '获取用户推文失败');
      }
    } finally {
      setLoading(false);
    }
  }, [collectCount, loading, screenName]);

  useEffect(() => {
    if (!autoSearchKey || consumedAutoSearchKeyRef.current === autoSearchKey) return;
    consumedAutoSearchKeyRef.current = autoSearchKey;
    void runUserTweets();
  }, [autoSearchKey, runUserTweets]);

  return (
    <>
      <SearchInput
        icon={<UserRound className="h-4 w-4" />}
        loading={loading}
        onSubmit={() => void runUserTweets()}
        placeholder="输入 X 用户名，例如 openai 或 @openai"
        submitLabel="获取"
        value={screenName}
        onChange={onScreenNameChange}
      />
      <p className="text-xs text-muted-foreground">
        获取指定用户主页最近推文，当前单次最多 1000 条；不是 X 首页推荐流。
      </p>
      <CollectionControls
        collectCount={collectCount}
        collectOptions={COLLECT_COUNT_OPTIONS}
        hits={hits}
        meta={meta}
        pageSize={pageSize}
        onCollectCountChange={setCollectCount}
        onPageSizeChange={(value) => {
          setPageSize(value);
          setPage(1);
        }}
      />
      <ResultState authExpired={authExpired} error={error} meta={meta} empty={hits?.length === 0 && !loading} />
      {hits && (
        <TweetList
          copiedUrl={copiedUrl}
          hits={hits}
          nextCollectCount={COLLECT_COUNT_OPTIONS.find((count) => count > collectCount)}
          page={page}
          pageSize={pageSize}
          onCopyUrl={onCopyUrl}
          onOpenTweet={onOpenTweet}
          onOpenUser={onOpenUser}
          onPageChange={setPage}
          onRequestMore={(count) => {
            setCollectCount(count);
            void runUserTweets(count);
          }}
        />
      )}
    </>
  );
}

function ThreadTab({
  autoSearchKey,
  copiedUrl,
  onCopyUrl,
  onOpenTweet,
  onOpenUser,
  onTweetIdOrUrlChange,
  tweetIdOrUrl,
}: {
  autoSearchKey: number;
  copiedUrl: string | null;
  onCopyUrl: (url: string) => Promise<void>;
  onOpenTweet: (hit: Hit) => void;
  onOpenUser: (screenName: string) => void;
  onTweetIdOrUrlChange: (tweetIdOrUrl: string) => void;
  tweetIdOrUrl: string;
}) {
  const [result, setResult] = useState<ThreadResult | null>(null);
  const [replyCount, setReplyCount] = useState(100);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const consumedAutoSearchKeyRef = useRef(0);

  const runThread = useCallback(async (overrideCount?: number, overrideTweetIdOrUrl?: string) => {
    const id = (overrideTweetIdOrUrl ?? tweetIdOrUrl).trim();
    const targetCount = overrideCount ?? replyCount;
    if (!id || loading) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ id, maxCount: String(targetCount), includeMain: '1' });
      if (targetCount > 20) params.set('partial', '1');
      const data = await fetchXJson(`/api/x/thread?${params.toString()}`);
      setAuthExpired(false);
      setResult({
        tweet: readHit(data.tweet),
        conversationId: typeof data.conversationId === 'string' ? data.conversationId : '',
        replies: readHits(data.replies),
        meta: {
          requestedCount: numberOrUndefined(data.requestedReplyCount),
          returnedCount: numberOrUndefined(data.returnedReplyCount),
          maxSupportedCount: numberOrUndefined(data.maxSupportedReplyCount),
          partial: Boolean(data.partial),
          timedOut: Boolean(data.timedOut),
          durationMs: numberOrUndefined(data.durationMs),
          error: typeof data.error === 'string' ? data.error : undefined,
        },
      });
      setPage(1);
    } catch (err) {
      if (isAuthExpiredError(err)) {
        setAuthExpired(true);
        setResult(null);
      } else {
        setError(err instanceof Error ? err.message : '获取推文详情失败');
      }
    } finally {
      setLoading(false);
    }
  }, [loading, replyCount, tweetIdOrUrl]);

  useEffect(() => {
    if (!autoSearchKey || consumedAutoSearchKeyRef.current === autoSearchKey) return;
    consumedAutoSearchKeyRef.current = autoSearchKey;
    void runThread();
  }, [autoSearchKey, runThread]);

  const replies = result?.replies || [];

  return (
    <>
      <SearchInput
        icon={<MessageSquareText className="h-4 w-4" />}
        loading={loading}
        onSubmit={() => void runThread()}
        placeholder="粘贴推文 URL 或输入 tweet id"
        submitLabel="获取详情"
        value={tweetIdOrUrl}
        onChange={onTweetIdOrUrlChange}
      />
      <p className="text-xs text-muted-foreground">
        会获取主推和同 conversation 下的评论/续推；评论当前最多 500 条，不是完整树状评论区。
      </p>
      <CollectionControls
        collectCount={replyCount}
        collectLabel="评论"
        collectOptions={REPLY_COUNT_OPTIONS}
        hits={result ? replies : null}
        meta={result?.meta || null}
        pageSize={pageSize}
        onCollectCountChange={setReplyCount}
        onPageSizeChange={(value) => {
          setPageSize(value);
          setPage(1);
        }}
      />
      <ResultState authExpired={authExpired} error={error} meta={result?.meta || null} empty={replies.length === 0 && !loading && Boolean(result)} />
      {result?.tweet && (
        <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
          <div className="mb-1 text-xs font-medium text-muted-foreground">主推</div>
          <TweetItem
            copiedUrl={copiedUrl}
            hit={result.tweet}
            onCopyUrl={onCopyUrl}
            onOpenTweet={onOpenTweet}
            onOpenUser={onOpenUser}
          />
        </div>
      )}
      {result && (
        <TweetList
          copiedUrl={copiedUrl}
          hits={replies}
          nextCollectCount={REPLY_COUNT_OPTIONS.find((count) => count > replyCount)}
          page={page}
          pageSize={pageSize}
          onCopyUrl={onCopyUrl}
          onOpenTweet={onOpenTweet}
          onOpenUser={onOpenUser}
          onPageChange={setPage}
          onRequestMore={(count) => {
            setReplyCount(count);
            void runThread(count);
          }}
        />
      )}
    </>
  );
}

function SearchInput({
  icon,
  loading,
  onChange,
  onSubmit,
  placeholder,
  submitLabel,
  value,
}: {
  icon: React.ReactNode;
  loading: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  submitLabel: string;
  value: string;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
        {icon}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onSubmit(); }}
        placeholder={placeholder}
        className="w-full rounded-md bg-muted/30 py-2 pl-9 pr-24 text-sm focus:outline-none focus:ring-1 focus:ring-primary/30"
      />
      <Button
        size="sm"
        onClick={onSubmit}
        disabled={loading || !value.trim()}
        className="absolute right-1 top-1/2 h-7 -translate-y-1/2"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : submitLabel}
      </Button>
    </div>
  );
}

function CollectionControls({
  collectCount,
  collectLabel = '采集',
  collectOptions,
  hits,
  meta,
  onCollectCountChange,
  onPageSizeChange,
  pageSize,
}: {
  collectCount: number;
  collectLabel?: string;
  collectOptions: number[];
  hits: Hit[] | null;
  meta: SearchMeta | null;
  onCollectCountChange: (value: number) => void;
  onPageSizeChange: (value: number) => void;
  pageSize: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <label className="flex items-center gap-1">
        <span>{collectLabel}</span>
        <select
          value={collectCount}
          onChange={(e) => onCollectCountChange(Number(e.target.value))}
          className="h-7 rounded-md border border-border/60 bg-background px-2 text-xs text-foreground"
        >
          {collectOptions.map((count) => (
            <option key={count} value={count}>{count} 条</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        <span>每页</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="h-7 rounded-md border border-border/60 bg-background px-2 text-xs text-foreground"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>{size} 条</option>
          ))}
        </select>
      </label>
      {hits && (
        <span className="ml-auto">
          已获取 {hits.length} 条
          {meta?.requestedCount ? ` / 请求 ${meta.requestedCount} 条` : ''}
          {meta?.durationMs ? ` · ${Math.round(meta.durationMs / 1000)}s` : ''}
        </span>
      )}
    </div>
  );
}

function ResultState({
  authExpired,
  empty,
  error,
  meta,
}: {
  authExpired: boolean;
  empty: boolean;
  error: string | null;
  meta: SearchMeta | null;
}) {
  if (authExpired) return <XAuthExpiredHint />;
  if (error) return <div className="text-sm text-red-500">请求失败：{error}</div>;
  if (meta?.partial) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
        本次返回部分结果{meta.timedOut ? '，采集过程中触发超时' : ''}。可以减少条数，或稍后重试。
      </div>
    );
  }
  if (empty) return <div className="py-4 text-center text-sm text-muted-foreground">没有找到匹配内容</div>;
  return null;
}

function TweetList({
  copiedUrl,
  hits,
  nextCollectCount,
  onCopyUrl,
  onOpenTweet,
  onOpenUser,
  onPageChange,
  onRequestMore,
  page,
  pageSize,
}: {
  copiedUrl: string | null;
  hits: Hit[];
  nextCollectCount?: number;
  onCopyUrl: (url: string) => Promise<void>;
  onOpenTweet: (hit: Hit) => void;
  onOpenUser: (screenName: string) => void;
  onPageChange: (page: number) => void;
  onRequestMore?: (count: number) => void;
  page: number;
  pageSize: number;
}) {
  const totalHits = hits.length;
  const totalPages = Math.max(1, Math.ceil(totalHits / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = totalHits > 0 ? (currentPage - 1) * pageSize : 0;
  const endIndex = Math.min(startIndex + pageSize, totalHits);
  const visibleHits = useMemo(
    () => hits.slice(startIndex, endIndex),
    [endIndex, hits, startIndex],
  );

  if (totalHits === 0) return null;

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border/60 max-h-[60vh] overflow-y-auto -mx-4 px-4">
        {visibleHits.map((hit) => (
          <li key={hit.id} className="py-3">
            <TweetItem
              copiedUrl={copiedUrl}
              hit={hit}
              onCopyUrl={onCopyUrl}
              onOpenTweet={onOpenTweet}
              onOpenUser={onOpenUser}
            />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3 text-xs text-muted-foreground">
        <div>
          第 {startIndex + 1}-{endIndex} 条 / 共 {totalHits} 条
          {totalPages > 1 ? ` · 第 ${currentPage}/${totalPages} 页` : ''}
        </div>
        <div className="flex items-center gap-2">
          {nextCollectCount && endIndex >= totalHits && onRequestMore && (
            <Button size="sm" variant="outline" onClick={() => onRequestMore(nextCollectCount)}>
              获取到 {nextCollectCount} 条
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="gap-1"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            上一页
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="gap-1"
          >
            下一页
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function TweetItem({
  copiedUrl,
  hit,
  onCopyUrl,
  onOpenTweet,
  onOpenUser,
}: {
  copiedUrl: string | null;
  hit: Hit;
  onCopyUrl: (url: string) => Promise<void>;
  onOpenTweet: (hit: Hit) => void;
  onOpenUser: (screenName: string) => void;
}) {
  const copied = copiedUrl === hit.url;
  const displayName = hit.authorName || hit.authorScreenName;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {hit.authorScreenName ? (
          <button
            type="button"
            title={`查看 @${hit.authorScreenName} 的推文`}
            onClick={() => onOpenUser(hit.authorScreenName)}
            className="inline-flex min-w-0 items-center gap-1 rounded-sm text-left hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            <span className="truncate font-medium text-foreground hover:text-primary">{displayName}</span>
            <span className="truncate">@{hit.authorScreenName}</span>
          </button>
        ) : (
          <span className="font-medium text-foreground">{displayName}</span>
        )}
        <span>·</span>
        <span>{formatRelative(hit.createdAt)}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            title={copied ? '已复制 URL' : '复制 URL'}
            onClick={() => void onCopyUrl(hit.url)}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md opacity-60 hover:bg-muted hover:opacity-100"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <a href={hit.url} target="_blank" rel="noreferrer" className="inline-flex h-6 w-6 items-center justify-center rounded-md opacity-60 hover:bg-muted hover:opacity-100">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
      <button
        type="button"
        title="查看推文详情"
        onClick={() => onOpenTweet(hit)}
        className="block w-full rounded-sm text-left text-sm whitespace-pre-wrap break-words hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
      >
        {hit.text}
      </button>
      <div className="flex gap-3 text-xs text-muted-foreground">
        <span>♻ {hit.retweetCount}</span>
        <span>♥ {hit.likeCount}</span>
        <span>💬 {hit.replyCount}</span>
      </div>
    </div>
  );
}

async function fetchXJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && (data as { code?: string })?.code === 'X_AUTH_EXPIRED') {
    throw new Error('X_AUTH_EXPIRED');
  }
  if (!res.ok || !(data as { ok?: boolean })?.ok) {
    throw new Error(String((data as { message?: unknown })?.message || `HTTP ${res.status}`));
  }
  return data as Record<string, unknown>;
}

function isAuthExpiredError(error: unknown): boolean {
  return error instanceof Error && error.message === 'X_AUTH_EXPIRED';
}

function readCollectionMeta(data: Record<string, unknown>): SearchMeta {
  return {
    requestedCount: numberOrUndefined(data.requestedCount),
    returnedCount: numberOrUndefined(data.returnedCount),
    maxSupportedCount: numberOrUndefined(data.maxSupportedCount),
    partial: Boolean(data.partial),
    timedOut: Boolean(data.timedOut),
    durationMs: numberOrUndefined(data.durationMs),
    error: typeof data.error === 'string' ? data.error : undefined,
  };
}

function readHits(value: unknown): Hit[] {
  return Array.isArray(value) ? value.map(readHit).filter((hit): hit is Hit => Boolean(hit)) : [];
}

function readHit(value: unknown): Hit | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const id = typeof item.id === 'string' ? item.id : '';
  const url = typeof item.url === 'string' ? item.url : '';
  if (!id || !url) return null;
  return {
    id,
    url,
    authorScreenName: typeof item.authorScreenName === 'string' ? item.authorScreenName : '',
    authorName: typeof item.authorName === 'string' ? item.authorName : '',
    text: typeof item.text === 'string' ? item.text : '',
    createdAt: numberOrZero(item.createdAt),
    likeCount: numberOrZero(item.likeCount),
    retweetCount: numberOrZero(item.retweetCount),
    replyCount: numberOrZero(item.replyCount),
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatRelative(ts: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 60 / 60_000)} 小时前`;
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
