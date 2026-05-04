'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  LayoutDashboard,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ButlerDiagnostic {
  severity: 'info' | 'warning' | 'error';
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
  };
  extensions?: {
    mcp?: {
      enabled?: number;
      healthy?: number;
      failed?: number;
      unknown?: number;
    };
    capabilities?: {
      published_prompt_nodes?: number;
      published_code_nodes?: number;
      failed_or_disabled?: number;
      ready_to_publish?: number;
    };
  };
  workflow?: {
    running_runs?: number;
    recent_failures?: number;
  };
  knowledge?: {
    items_total?: number;
    failed_items?: number;
    pending_or_processing_items?: number;
  };
  deepsearch?: {
    running_runs?: number;
    waiting_login_runs?: number;
    failed_runs?: number;
  };
  browser?: {
    enabled_contexts?: number;
    failed_or_untested?: number;
  };
  diagnostics?: ButlerDiagnostic[];
}

interface ButlerStatusPanelProps {
  sessionId?: string;
  compact?: boolean;
}

const severityOrder: Record<ButlerDiagnostic['severity'], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const severityLabel: Record<ButlerDiagnostic['severity'], string> = {
  error: '需要处理',
  warning: '需关注',
  info: '提示',
};

export function ButlerStatusPanel({ sessionId, compact = false }: ButlerStatusPanelProps) {
  const router = useRouter();
  const [status, setStatus] = useState<ButlerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(!compact);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ include_recent: 'true' });
      if (sessionId) params.set('session_id', sessionId);
      const res = await fetch(`/api/main-agent/butler/status?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setStatus(data as ButlerStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

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
  const visibleDiagnostics = expanded ? diagnostics.slice(0, 8) : diagnostics.slice(0, 3);
  const isHealthy = !loading && !error && errorCount === 0 && warningCount === 0;

  return (
    <section className="shrink-0 border-b border-border/50 bg-background/95 px-4 py-2">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className={cn(
              'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border',
              isHealthy ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : 'border-amber-500/30 bg-amber-500/10 text-amber-600',
            )}>
              {isHealthy ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium">Lumos 管家状态</p>
                {loading ? (
                  <Badge variant="secondary">读取中</Badge>
                ) : error ? (
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
                {status?.generated_at ? `更新时间 ${formatTime(status.generated_at)}` : '服务商、MCP、任务、知识库和浏览器状态'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" size="xs" variant="outline" onClick={() => router.push('/main-agent/butler')}>
              <LayoutDashboard className="h-3.5 w-3.5" />
              总览
            </Button>
            <Button type="button" size="icon-xs" variant="ghost" onClick={() => void loadStatus()} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              <span className="sr-only">刷新</span>
            </Button>
            <Button type="button" size="icon-xs" variant="ghost" onClick={() => setExpanded((value) => !value)}>
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              <span className="sr-only">{expanded ? '收起' : '展开'}</span>
            </Button>
          </div>
        </div>

        {expanded && status && (
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="服务商" value={status.providers?.default_provider_name || `${status.providers?.total ?? 0} 个`} />
            <Metric label="MCP" value={`${status.extensions?.mcp?.healthy ?? 0}/${status.extensions?.mcp?.enabled ?? 0} 可用`} warn={(status.extensions?.mcp?.failed ?? 0) > 0 || (status.extensions?.mcp?.unknown ?? 0) > 0} />
            <Metric label="能力" value={`${(status.extensions?.capabilities?.published_prompt_nodes ?? 0) + (status.extensions?.capabilities?.published_code_nodes ?? 0)} 已发布`} warn={(status.extensions?.capabilities?.failed_or_disabled ?? 0) > 0} />
            <Metric label="任务" value={`${status.workflow?.running_runs ?? 0} 运行中`} warn={(status.workflow?.recent_failures ?? 0) > 0} />
            <Metric label="知识库" value={`${status.knowledge?.items_total ?? 0} 条`} warn={(status.knowledge?.failed_items ?? 0) > 0 || (status.knowledge?.pending_or_processing_items ?? 0) > 0} />
            <Metric label="浏览器" value={`${status.browser?.enabled_contexts ?? 0} 启用`} warn={(status.browser?.failed_or_untested ?? 0) > 0} />
          </div>
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {!error && visibleDiagnostics.length > 0 && (
          <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
            {visibleDiagnostics.map((item, index) => (
              <div
                key={`${item.area}-${item.title}-${index}`}
                className="flex items-start justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={item.severity} />
                    <span className="text-sm font-medium">{item.title}</span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.message}</p>
                </div>
                {item.route && (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => router.push(item.route!)}
                  >
                    打开
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value, warn = false }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className={cn(
      'min-w-0 rounded-md border px-2.5 py-2',
      warn ? 'border-amber-500/25 bg-amber-500/5' : 'border-border/60 bg-muted/15',
    )}>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: ButlerDiagnostic['severity'] }) {
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

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
