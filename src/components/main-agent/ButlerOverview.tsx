'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Bot,
  CheckCircle2,
  CircleAlert,
  Database,
  ExternalLink,
  RefreshCw,
  Search,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type ButlerSeverity = 'info' | 'warning' | 'error';
type SearchScope = 'all' | 'sessions' | 'messages' | 'tasks' | 'workflows' | 'deepsearch' | 'capabilities';

interface ButlerDiagnostic {
  severity: ButlerSeverity;
  area: string;
  title: string;
  message: string;
  route?: string;
}

interface ButlerStatus {
  generated_at: string;
  providers?: {
    total?: number;
    default_provider_name?: string | null;
    agent_chat_ready_count?: number;
    text_gen_ready_count?: number;
    image_gen_ready_count?: number;
    embedding_ready_count?: number;
  };
  extensions?: {
    mcp?: {
      total?: number;
      enabled?: number;
      healthy?: number;
      failed?: number;
      unknown?: number;
    };
    skills?: {
      total?: number;
      enabled?: number;
      builtin?: number;
      user?: number;
    };
    capabilities?: {
      packages_total?: number;
      drafts_total?: number;
      published_prompt_nodes?: number;
      published_code_nodes?: number;
      failed_or_disabled?: number;
      ready_to_publish?: number;
      recent?: Array<{
        id: string;
        name: string;
        kind?: string;
        status?: string;
        updated_at?: string;
      }>;
    };
  };
  workflow?: {
    schedules_total?: number;
    schedules_enabled?: number;
    one_time_tasks?: number;
    running_runs?: number;
    recent_failures?: number;
    projection_running?: number;
    projection_failed?: number;
    recent_runs?: Array<{
      id: string;
      schedule_id: string;
      schedule_name?: string;
      status?: string;
      error?: string;
      started_at?: string;
      route?: string;
    }>;
  };
  sessions?: {
    total?: number;
    main_agent_sessions?: number;
    active_runtime_sessions?: number;
    latest_session_at?: string | null;
    recent?: Array<{
      id: string;
      title?: string;
      mode?: string;
      provider_name?: string;
      model?: string;
      updated_at?: string;
      route?: string;
    }>;
  };
  knowledge?: {
    collections?: number;
    items_total?: number;
    chunks_total?: number;
    embedded_chunks?: number;
    failed_items?: number;
    pending_or_processing_items?: number;
  };
  deepsearch?: {
    sites_total?: number;
    login_ready_sites?: number;
    waiting_login_sites?: number;
    running_runs?: number;
    waiting_login_runs?: number;
    failed_runs?: number;
    recent_runs?: Array<{
      id: string;
      query?: string;
      status?: string;
      status_message?: string;
      updated_at?: string;
      route?: string;
    }>;
  };
  browser?: {
    contexts_total?: number;
    enabled_contexts?: number;
    failed_or_untested?: number;
    contexts?: Array<{
      context_id: string;
      display_name?: string;
      provider_type?: string;
      enabled?: boolean;
      last_test_status?: string;
      last_test_message?: string;
      chat_session_count?: number;
      schedule_count?: number;
    }>;
  };
  runtime_resources?: {
    node_runtime_found?: boolean;
    python_runtime_found?: boolean;
    git_bash_found?: boolean;
    embedding_model_found?: boolean;
    manifest_found?: boolean;
  };
  diagnostics?: ButlerDiagnostic[];
}

interface HistoryResult {
  type: string;
  id: string;
  title?: string;
  snippet?: string;
  status?: string;
  role?: string;
  updated_at?: string;
  created_at?: string;
  route?: string;
}

interface HistorySearchResponse {
  total?: number;
  results?: HistoryResult[];
}

const severityOrder: Record<ButlerSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const severityLabel: Record<ButlerSeverity, string> = {
  error: '需要处理',
  warning: '需关注',
  info: '提示',
};

const scopeOptions: Array<{ value: SearchScope; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'sessions', label: '会话' },
  { value: 'messages', label: '消息' },
  { value: 'tasks', label: '任务' },
  { value: 'workflows', label: 'Workflow' },
  { value: 'deepsearch', label: 'DeepSearch' },
  { value: 'capabilities', label: '能力' },
];

export function ButlerOverview() {
  const router = useRouter();
  const [status, setStatus] = useState<ButlerStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState('');
  const [tab, setTab] = useState('overview');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [searchResults, setSearchResults] = useState<HistoryResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searched, setSearched] = useState(false);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    setStatusError('');
    try {
      const res = await fetch('/api/main-agent/butler/status?include_recent=true', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setStatus(data as ButlerStatus);
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const diagnostics = useMemo(() => (
    [...(status?.diagnostics ?? [])].sort((left, right) => (
      severityOrder[left.severity] - severityOrder[right.severity]
    ))
  ), [status?.diagnostics]);

  const errorCount = diagnostics.filter((item) => item.severity === 'error').length;
  const warningCount = diagnostics.filter((item) => item.severity === 'warning').length;
  const isHealthy = !statusLoading && !statusError && errorCount === 0 && warningCount === 0;

  const runSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearchLoading(true);
    setSearchError('');
    setSearched(true);
    try {
      const params = new URLSearchParams({
        q: trimmed,
        scope,
        limit: '12',
      });
      const res = await fetch(`/api/main-agent/butler/search?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json() as HistorySearchResponse & { error?: string };
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setSearchResults(data.results ?? []);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : String(error));
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [query, scope]);

  const handleSearchSubmit = useCallback((event: FormEvent) => {
    event.preventDefault();
    void runSearch();
  }, [runSearch]);

  const openRoute = useCallback((route?: string) => {
    if (!route) return;
    router.push(route);
  }, [router]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/50 px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => router.push('/main-agent')}>
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">返回主 Agent</span>
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold">Lumos 管家总览</h1>
              {statusLoading ? (
                <Badge variant="secondary">读取中</Badge>
              ) : statusError ? (
                <Badge variant="destructive">读取失败</Badge>
              ) : isHealthy ? (
                <Badge variant="secondary">暂无明显问题</Badge>
              ) : (
                <>
                  {errorCount > 0 && <Badge variant="destructive">{errorCount} 个需要处理</Badge>}
                  {warningCount > 0 && <Badge variant="outline">{warningCount} 个需关注</Badge>}
                </>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {status?.generated_at ? `更新时间 ${formatTime(status.generated_at)}` : '全局只读状态'}
            </p>
          </div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadStatus()} disabled={statusLoading}>
          <RefreshCw className={cn('h-4 w-4', statusLoading && 'animate-spin')} />
          刷新
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
        <div className="shrink-0 border-b border-border/40 px-6 py-2">
          <TabsList>
            <TabsTrigger value="overview">总览</TabsTrigger>
            <TabsTrigger value="history">历史搜索</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="min-h-0 overflow-y-auto px-6 py-4">
          {statusError ? (
            <ErrorBox message={statusError} />
          ) : (
            <div className="mx-auto flex max-w-6xl flex-col gap-4">
              <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <SummaryTile
                  icon={Bot}
                  label="服务商"
                  value={status?.providers?.default_provider_name || `${status?.providers?.total ?? 0} 个`}
                  detail={`${status?.providers?.agent_chat_ready_count ?? 0} 个支持 Agent`}
                  route="/settings#providers"
                  onOpen={openRoute}
                />
                <SummaryTile
                  icon={Database}
                  label="MCP / Skill"
                  value={`${status?.extensions?.mcp?.enabled ?? 0} / ${status?.extensions?.skills?.enabled ?? 0}`}
                  detail={`${status?.extensions?.mcp?.unknown ?? 0} 个 MCP 未检测`}
                  warn={(status?.extensions?.mcp?.failed ?? 0) > 0 || (status?.extensions?.mcp?.unknown ?? 0) > 0}
                  route="/extensions?tab=mcp"
                  onOpen={openRoute}
                />
                <SummaryTile
                  icon={Workflow}
                  label="任务"
                  value={`${status?.workflow?.running_runs ?? 0} 运行中`}
                  detail={`${status?.workflow?.recent_failures ?? 0} 个近期失败`}
                  warn={(status?.workflow?.recent_failures ?? 0) > 0 || (status?.workflow?.projection_failed ?? 0) > 0}
                  route="/workflow/schedules"
                  onOpen={openRoute}
                />
                <SummaryTile
                  icon={BookOpen}
                  label="知识库"
                  value={`${status?.knowledge?.items_total ?? 0} 条`}
                  detail={`${status?.knowledge?.embedded_chunks ?? 0}/${status?.knowledge?.chunks_total ?? 0} 已向量化`}
                  warn={(status?.knowledge?.failed_items ?? 0) > 0 || (status?.knowledge?.pending_or_processing_items ?? 0) > 0}
                  route="/library"
                  onOpen={openRoute}
                />
              </section>

              <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                <div className="rounded-md border border-border/60 bg-background">
                  <SectionHeader title="问题诊断" action={diagnostics.length ? `${diagnostics.length} 条` : '0 条'} />
                  {statusLoading ? (
                    <PanelLoading />
                  ) : diagnostics.length === 0 ? (
                    <EmptyState text="暂无明显问题" />
                  ) : (
                    <div className="max-h-80 space-y-2 overflow-y-auto p-3">
                      {diagnostics.map((item, index) => (
                        <DiagnosticRow key={`${item.area}-${item.title}-${index}`} item={item} onOpen={openRoute} />
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-md border border-border/60 bg-background">
                  <SectionHeader title="运行资源" action={resourceSummary(status)} />
                  <div className="grid gap-2 p-3 text-sm">
                    <StateLine label="Node runtime" ok={Boolean(status?.runtime_resources?.node_runtime_found)} />
                    <StateLine label="Python runtime" ok={Boolean(status?.runtime_resources?.python_runtime_found)} />
                    <StateLine label="Git Bash" ok={Boolean(status?.runtime_resources?.git_bash_found)} muted />
                    <StateLine label="Embedding 模型" ok={Boolean(status?.runtime_resources?.embedding_model_found)} />
                    <StateLine label="资源清单" ok={Boolean(status?.runtime_resources?.manifest_found)} />
                  </div>
                </div>
              </section>

              <section className="grid gap-4 xl:grid-cols-3">
                <RecentList
                  title="最近会话"
                  emptyText="暂无会话"
                  items={(status?.sessions?.recent ?? []).map((item) => ({
                    id: item.id,
                    title: item.title || '未命名会话',
                    subtitle: [item.provider_name, item.model].filter(Boolean).join(' / ') || item.mode || '',
                    time: item.updated_at,
                    route: item.route,
                  }))}
                  onOpen={openRoute}
                />
                <RecentList
                  title="最近 Workflow"
                  emptyText="暂无执行记录"
                  items={(status?.workflow?.recent_runs ?? []).map((item) => ({
                    id: item.id,
                    title: item.schedule_name || item.id,
                    subtitle: item.error || item.status || '',
                    time: item.started_at,
                    route: item.route,
                    badge: item.status,
                  }))}
                  onOpen={openRoute}
                />
                <RecentList
                  title="DeepSearch"
                  emptyText="暂无 DeepSearch 记录"
                  items={(status?.deepsearch?.recent_runs ?? []).map((item) => ({
                    id: item.id,
                    title: item.query || item.id,
                    subtitle: item.status_message || item.status || '',
                    time: item.updated_at,
                    route: item.route,
                    badge: item.status,
                  }))}
                  onOpen={openRoute}
                />
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-md border border-border/60 bg-background">
                  <SectionHeader title="能力" action={`${(status?.extensions?.capabilities?.published_prompt_nodes ?? 0) + (status?.extensions?.capabilities?.published_code_nodes ?? 0)} 已发布`} />
                  <div className="grid gap-2 p-3 text-sm">
                    <CompactStat label="Prompt 节点" value={status?.extensions?.capabilities?.published_prompt_nodes ?? 0} />
                    <CompactStat label="代码节点" value={status?.extensions?.capabilities?.published_code_nodes ?? 0} />
                    <CompactStat label="待发布" value={status?.extensions?.capabilities?.ready_to_publish ?? 0} />
                    <CompactStat label="失败或停用" value={status?.extensions?.capabilities?.failed_or_disabled ?? 0} warn={(status?.extensions?.capabilities?.failed_or_disabled ?? 0) > 0} />
                  </div>
                </div>
                <div className="rounded-md border border-border/60 bg-background">
                  <SectionHeader title="浏览器" action={`${status?.browser?.enabled_contexts ?? 0} 启用`} />
                  {(status?.browser?.contexts ?? []).length === 0 ? (
                    <EmptyState text="暂无浏览器配置" />
                  ) : (
                    <div className="max-h-64 space-y-2 overflow-y-auto p-3">
                      {(status?.browser?.contexts ?? []).map((item) => (
                        <div key={item.context_id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{item.display_name || item.context_id}</div>
                            <div className="truncate text-xs text-muted-foreground">
                              {item.provider_type || 'browser'} · 会话 {item.chat_session_count ?? 0} · 任务 {item.schedule_count ?? 0}
                            </div>
                          </div>
                          <Badge variant={item.last_test_status === 'success' ? 'secondary' : 'outline'}>
                            {item.last_test_status || 'unknown'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="min-h-0 overflow-y-auto px-6 py-4">
          <div className="mx-auto flex max-w-5xl flex-col gap-4">
            <form className="flex flex-col gap-2 rounded-md border border-border/60 bg-background p-3 sm:flex-row" onSubmit={handleSearchSubmit}>
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索会话、消息、任务、Workflow、DeepSearch、能力"
                  className="pl-9"
                />
              </div>
              <Select value={scope} onValueChange={(value) => setScope(value as SearchScope)}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {scopeOptions.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit" disabled={!query.trim() || searchLoading}>
                <Search className="h-4 w-4" />
                搜索
              </Button>
            </form>

            {searchError && <ErrorBox message={searchError} />}

            <div className="rounded-md border border-border/60 bg-background">
              <SectionHeader title="搜索结果" action={searched ? `${searchResults.length} 条` : '未搜索'} />
              {searchLoading ? (
                <PanelLoading />
              ) : searched && searchResults.length === 0 && !searchError ? (
                <EmptyState text="没有找到匹配结果" />
              ) : !searched ? (
                <EmptyState text="输入关键词后开始搜索" />
              ) : (
                <div className="max-h-[calc(100vh-260px)] min-h-0 space-y-2 overflow-y-auto p-3">
                  {searchResults.map((item) => (
                    <SearchResultRow key={`${item.type}-${item.id}`} item={item} onOpen={openRoute} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SectionHeader({ title, action }: { title: string; action?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2">
      <h2 className="truncate text-sm font-semibold">{title}</h2>
      {action && <span className="shrink-0 text-xs text-muted-foreground">{action}</span>}
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  detail,
  warn = false,
  route,
  onOpen,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  warn?: boolean;
  route?: string;
  onOpen: (route?: string) => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex min-h-28 min-w-0 items-start justify-between gap-3 rounded-md border px-3 py-3 text-left transition-colors hover:bg-muted/35',
        warn ? 'border-amber-500/30 bg-amber-500/5' : 'border-border/60 bg-background',
      )}
      onClick={() => onOpen(route)}
    >
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 truncate text-lg font-semibold">{value}</div>
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{detail}</div>
      </div>
      <div className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border',
        warn ? 'border-amber-500/30 text-amber-700 dark:text-amber-300' : 'border-border/70 text-muted-foreground',
      )}>
        <Icon className="h-4 w-4" />
      </div>
    </button>
  );
}

function DiagnosticRow({ item, onOpen }: { item: ButlerDiagnostic; onOpen: (route?: string) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/15 px-3 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={item.severity} />
          <span className="text-sm font-medium">{item.title}</span>
        </div>
        <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{item.message}</p>
      </div>
      {item.route && (
        <Button type="button" variant="outline" size="xs" className="shrink-0" onClick={() => onOpen(item.route)}>
          <ExternalLink className="h-3.5 w-3.5" />
          打开
        </Button>
      )}
    </div>
  );
}

function SearchResultRow({ item, onOpen }: { item: HistoryResult; onOpen: (route?: string) => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/15 px-3 py-2">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{typeLabel(item.type)}</Badge>
          {item.status && <Badge variant="outline">{item.status}</Badge>}
          <span className="truncate text-sm font-medium">{item.title || item.id}</span>
        </div>
        {item.snippet && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{item.snippet}</p>}
        <p className="mt-1 truncate text-[11px] text-muted-foreground">
          {formatTime(item.updated_at || item.created_at || '')}
        </p>
      </div>
      {item.route && (
        <Button type="button" variant="outline" size="xs" className="shrink-0" onClick={() => onOpen(item.route)}>
          <ExternalLink className="h-3.5 w-3.5" />
          打开
        </Button>
      )}
    </div>
  );
}

function RecentList({
  title,
  emptyText,
  items,
  onOpen,
}: {
  title: string;
  emptyText: string;
  items: Array<{ id: string; title: string; subtitle?: string; time?: string; route?: string; badge?: string }>;
  onOpen: (route?: string) => void;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background">
      <SectionHeader title={title} action={`${items.length} 条`} />
      {items.length === 0 ? (
        <EmptyState text={emptyText} />
      ) : (
        <div className="max-h-72 space-y-2 overflow-y-auto p-3">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex w-full min-w-0 items-start justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-left transition-colors hover:bg-muted/35"
              onClick={() => onOpen(item.route)}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{item.title}</div>
                {item.subtitle && <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.subtitle}</div>}
                {item.time && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{formatTime(item.time)}</div>}
              </div>
              {item.badge && <Badge variant="outline" className="shrink-0">{item.badge}</Badge>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CompactStat({ label, value, warn = false }: { label: string; value: number | string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-medium', warn && 'text-amber-700 dark:text-amber-300')}>{value}</span>
    </div>
  );
}

function StateLine({ label, ok, muted = false }: { label: string; ok: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        ok ? 'text-emerald-700 dark:text-emerald-300' : muted ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300',
      )}>
        {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
        {ok ? '已发现' : '未发现'}
      </span>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: ButlerSeverity }) {
  if (severity === 'error') {
    return <Badge variant="destructive">{severityLabel[severity]}</Badge>;
  }
  if (severity === 'warning') {
    return (
      <Badge variant="outline" className="border-amber-500/30 text-amber-700 dark:text-amber-300">
        <AlertTriangle className="h-3 w-3" />
        {severityLabel[severity]}
      </Badge>
    );
  }
  return <Badge variant="secondary">{severityLabel[severity]}</Badge>;
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
      {message}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-28 items-center justify-center px-3 py-6 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function PanelLoading() {
  return (
    <div className="flex min-h-28 items-center justify-center px-3 py-6 text-sm text-muted-foreground">
      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
      读取中
    </div>
  );
}

function resourceSummary(status: ButlerStatus | null): string {
  if (!status?.runtime_resources) return '未知';
  const found = [
    status.runtime_resources.node_runtime_found,
    status.runtime_resources.python_runtime_found,
    status.runtime_resources.git_bash_found,
    status.runtime_resources.embedding_model_found,
    status.runtime_resources.manifest_found,
  ].filter(Boolean).length;
  return `${found}/5`;
}

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    session: '会话',
    message: '消息',
    task: '任务',
    workflow_schedule: 'Workflow',
    workflow_definition: '定义',
    deepsearch_run: 'DeepSearch',
    capability: '能力',
  };
  return labels[type] || type;
}

function formatTime(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
