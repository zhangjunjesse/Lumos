'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertCircle, ExternalLink, Loader2, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import {
  type RunSearchInput,
  type SearchResult,
  type SearchResultItem,
  type SearchScope,
  useGoofishSearch,
} from './use-goofish-search';

interface ScopeOption {
  value: SearchScope;
  label: string;
  hint: string;
  reachable: boolean;
}

const SCOPE_OPTIONS: ScopeOption[] = [
  { value: 'history', label: '历史会话', hint: '本机已同步的买家消息全文检索', reachable: true },
  { value: 'buyer', label: '买家档案', hint: '按买家昵称、ID、备注匹配', reachable: true },
  { value: 'market', label: '全平台市场', hint: '通过已登录账号 cookies 拉闲鱼搜索', reachable: true },
  { value: 'shop', label: '店内商品', hint: '暂未接入', reachable: false },
];

const LIMIT_OPTIONS = [10, 20, 50];

export function SearchTab(): React.ReactElement {
  const [scope, setScope] = React.useState<SearchScope>('history');
  const [query, setQuery] = React.useState('');
  const [limit, setLimit] = React.useState(10);
  const { result, loading, error, run, reset } = useGoofishSearch();

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    const text = query.trim();
    if (!text) return;
    void run({ scope, query: text, limit } satisfies RunSearchInput);
  };

  const onScopeChange = (next: SearchScope) => {
    setScope(next);
    reset();
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold tracking-tight">搜索</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          按范围检索本机已同步的会话、买家档案，或通过登录账号去查全平台市场。
        </p>
      </div>

      <Tabs value={scope} onValueChange={(value) => onScopeChange(value as SearchScope)}>
        <TabsList className="flex-wrap">
          {SCOPE_OPTIONS.map((opt) => (
            <TabsTrigger
              key={opt.value}
              value={opt.value}
              disabled={!opt.reachable}
              title={opt.reachable ? opt.hint : '暂未接入'}
              className={cn(!opt.reachable && 'cursor-not-allowed text-muted-foreground')}
            >
              {opt.label}
              {!opt.reachable ? (
                <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  暂未接入
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <form
        onSubmit={submit}
        className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_120px_auto]"
      >
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholderForScope(scope)}
            className="pl-8"
          />
        </div>
        <Select value={String(limit)} onValueChange={(value) => setLimit(Number(value) || 10)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LIMIT_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)} className="tabular-nums">
                {n} 条
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={!query.trim() || loading}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          搜索
        </Button>
      </form>

      <SearchBody scope={scope} loading={loading} error={error} result={result} />
    </div>
  );
}

function SearchBody({
  scope,
  loading,
  error,
  result,
}: {
  scope: SearchScope;
  loading: boolean;
  error: string | null;
  result: SearchResult | null;
}): React.ReactElement {
  if (scope === 'shop') {
    return (
      <NotConnectedBanner
        title="店内商品搜索暂未接入"
        reason="当前 goofish MCP 和内置 API 不提供「列出本店上架商品」能力，需扩展 goofish MCP 或新增 mtop 商品列表接口。"
      />
    );
  }
  if (loading && !result) {
    return (
      <div className="flex min-h-32 items-center justify-center gap-2 rounded-lg border border-dashed text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        搜索中…
      </div>
    );
  }
  if (result && !result.reachable) {
    return (
      <NotConnectedBanner
        title={`${scopeLabel(result.scope)}范围当前不可达`}
        reason={result.notReachableReason ?? '范围不可用，请检查依赖项'}
        errors={result.errors}
      />
    );
  }
  if (error && !result) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }
  if (!result) {
    return (
      <div className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
        输入关键词并点击搜索
      </div>
    );
  }
  if (result.items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
        没有找到匹配「{result.query}」的结果
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] text-muted-foreground">
        {scopeLabel(result.scope)} · {result.total} 条结果
      </p>
      {result.items.map((item, index) => (
        <SearchResultCard key={`${item.scope}-${item.id}-${index}`} item={item} />
      ))}
    </div>
  );
}

function SearchResultCard({ item }: { item: SearchResultItem }): React.ReactElement {
  const link = buildItemLink(item);
  return (
    <Card className="border-border/70">
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{item.title}</p>
            {item.subtitle ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.subtitle}</p>
            ) : null}
          </div>
          {link ? (
            <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
              <Link href={link.href} target={link.external ? '_blank' : undefined}>
                <ExternalLink className="size-3.5" />
                {link.label}
              </Link>
            </Button>
          ) : null}
        </div>
        {item.snippet ? (
          <p className="whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
            {trimSnippet(item.snippet)}
          </p>
        ) : null}
        {item.meta && Object.keys(item.meta).length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {Object.entries(item.meta).map(([key, value]) => (
              <span
                key={key}
                className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {metaLabel(key)}: {String(value)}
              </span>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NotConnectedBanner({
  title,
  reason,
  errors,
}: {
  title: string;
  reason: string;
  errors?: string[];
}) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-300">
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="mt-1 leading-5">{reason}</p>
        {errors && errors.length > 0 ? (
          <ul className="mt-1 list-disc pl-4 leading-5">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function placeholderForScope(scope: SearchScope): string {
  if (scope === 'history') return '搜索历史消息中的关键词、金额、承诺…';
  if (scope === 'buyer') return '搜索买家昵称、ID 或备注…';
  if (scope === 'market') return '搜索闲鱼全平台商品…';
  return '搜索…';
}

function buildItemLink(item: SearchResultItem): { href: string; label: string; external?: boolean } | null {
  if (item.link?.type === 'conversation') {
    return { href: '/apps/goofish-assistant?tab=inbox', label: '打开收件箱' };
  }
  if (item.link?.type === 'buyer') {
    return { href: '/apps/goofish-assistant?tab=inbox', label: '查看买家' };
  }
  const url = item.meta?.url;
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    return { href: url, label: '打开链接', external: true };
  }
  return null;
}

function trimSnippet(text: string): string {
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

function scopeLabel(scope: SearchScope): string {
  return SCOPE_OPTIONS.find((opt) => opt.value === scope)?.label ?? scope;
}

function metaLabel(key: string): string {
  const map: Record<string, string> = {
    price: '价格',
    sellerNick: '卖家',
    location: '地区',
    url: '链接',
    cid: '会话',
    from: '发自',
    createdAt: '时间',
    itemId: '商品',
    accountUnb: '账号',
    buyerUserId: '买家 ID',
    unreadCount: '未读',
    replyStatus: '状态',
    lastMessageAt: '最后消息',
  };
  return map[key] ?? key;
}
