'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import type { WeChatReport } from './automations-types';
import { formatReportTime, isWeChatReport, runStatusClass, runStatusLabel } from './automation-format';
import { ReportDetailDialog } from './ReportDetailDialog';
import { ReportDownloadButton } from './ReportDownloadButton';
import { reportExecutionHref } from './report-ui';

const PAGE_SIZE = 8;
const STATUS_TABS = [
  ['all', '全部'],
  ['success', '成功'],
  ['running', '运行中'],
  ['error', '失败'],
  ['cancelled', '取消'],
] as const;

export function ReportsPane({
  triggerMessage,
  onAutomationsRefresh,
}: {
  triggerMessage: string | null;
  onAutomationsRefresh: () => Promise<void> | void;
}): React.ReactElement {
  const [reports, setReports] = React.useState<WeChatReport[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<WeChatReport['status'] | 'all'>('all');
  const [page, setPage] = React.useState(1);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const loadReports = React.useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const res = await fetch('/api/apps/builtin/wechat/reports', { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as { reports?: unknown; error?: string; message?: string };
      if (!res.ok || !Array.isArray(json.reports) || !json.reports.every(isWeChatReport)) {
        throw new Error(json.message ?? json.error ?? '报告加载失败');
      }
      setReports(json.reports);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '报告加载失败');
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, []);

  React.useEffect(() => { void loadReports(); }, [loadReports]);

  React.useEffect(() => {
    if (!triggerMessage) return;
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      void loadReports({ silent: true });
      void onAutomationsRefresh();
      if (count >= 6) clearInterval(timer);
    }, 1500);
    return () => clearInterval(timer);
  }, [loadReports, onAutomationsRefresh, triggerMessage]);

  const hasRunning = reports.some((r) => r.status === 'running');
  React.useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(() => {
      void loadReports({ silent: true });
      void onAutomationsRefresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [hasRunning, loadReports, onAutomationsRefresh]);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return reports.filter((report) => {
      if (statusFilter !== 'all' && report.status !== statusFilter) return false;
      if (!needle) return true;
      return [report.automationName, report.summary, report.error, report.searchText, report.reportFileName ?? '']
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [query, reports, statusFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  React.useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const selected = reports.find((r) => r.id === selectedId) ?? null;

  const deleteReport = React.useCallback(async (report: WeChatReport) => {
    if (typeof window !== 'undefined'
      && !window.confirm(`删除报告「${report.automationName}」？删除后不会再出现在运行记录里。`)) {
      return;
    }
    setDeletingId(report.id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/apps/builtin/wechat/reports/${encodeURIComponent(report.id)}`, { method: 'DELETE' });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? '删除报告失败');
      if (selectedId === report.id) setSelectedId(null);
      await loadReports({ silent: true });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : '删除报告失败');
    } finally {
      setDeletingId(null);
    }
  }, [loadReports, selectedId]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">运行记录</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            共 {filtered.length} 条 · 点条目查看完整报告，正文不在列表里展开。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadReports()} disabled={loading}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          刷新
        </Button>
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="搜索报告、自动化名称或错误原因"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map(([value, label]) => (
            <Button
              key={value}
              type="button"
              variant={statusFilter === value ? 'default' : 'outline'}
              size="xs"
              onClick={() => { setStatusFilter(value); setPage(1); }}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</div>
      ) : null}
      {deleteError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{deleteError}</div>
      ) : null}

      {loading && reports.length === 0 ? (
        <div className="flex min-h-24 items-center justify-center gap-2 rounded-lg border border-dashed text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          加载运行结果中…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed px-3 py-8 text-center text-xs leading-5 text-muted-foreground">
          {reports.length === 0 ? '还没有运行结果。任务触发后会出现在这里。' : '没有匹配的运行结果'}
        </div>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {pageItems.map((report) => (
              <ReportListItem
                key={report.id}
                report={report}
                deleting={deletingId === report.id}
                onOpen={() => setSelectedId(report.id)}
                onDelete={() => void deleteReport(report)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {filtered.length > PAGE_SIZE ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>第 {safePage} / {pageCount} 页</span>
          <div className="flex gap-1">
            <Button variant="outline" size="xs" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
              <ChevronLeft className="size-3.5" />
              上一页
            </Button>
            <Button variant="outline" size="xs" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>
              下一页
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : null}

      <ReportDetailDialog
        report={selected}
        open={Boolean(selected)}
        deleting={selected ? deletingId === selected.id : false}
        onDelete={(report) => void deleteReport(report)}
        onOpenChange={(open) => { if (!open) setSelectedId(null); }}
      />
    </div>
  );
}

function ReportListItem({
  report,
  deleting,
  onOpen,
  onDelete,
}: {
  report: WeChatReport;
  deleting: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{report.automationName}</span>
            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px]', runStatusClass(report.status))}>
              {runStatusLabel(report.status)}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {formatReportTime(report.startedAt)}
            {report.error ? ` · ${report.error}` : report.summary ? ` · ${report.summary}` : ''}
          </p>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {report.detailAvailable && report.scheduleId && report.runId ? (
          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
            <Link href={reportExecutionHref(report)}>
              <ExternalLink className="size-3.5" />
              <span className="hidden sm:inline">执行记录</span>
            </Link>
          </Button>
        ) : null}
        <ReportDownloadButton report={report} label="" variant="ghost" className="h-7 px-2 text-xs" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
          disabled={deleting}
          onClick={onDelete}
        >
          {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}
