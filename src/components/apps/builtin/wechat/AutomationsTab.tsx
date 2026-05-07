'use client';

import * as React from 'react';
import Link from 'next/link';
import { cjk } from '@streamdown/cjk';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import { AlertCircle, Bell, CheckCircle2, Download, ExternalLink, FileText, Loader2, Play, Plus, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react';
import { Streamdown } from 'streamdown';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { streamdownCode } from '@/lib/streamdown-code';
import { cn } from '@/lib/utils';

import type { WeChatReport } from './automations-types';
import {
  filenameFromDisposition,
  reportExecutionHref,
  reportPreview,
  safeReportName,
} from './report-ui';
import { formatDateTime } from './wechat-types';
import type { Automation, AutomationKind, Followup } from './relations-types';

const markdownPlugins = { cjk, code: streamdownCode, math, mermaid };

export function AutomationsTab({
  automations,
  followups,
  systemAutomation,
  loading,
  saving,
  canRetrySave,
  triggeringId,
  triggerMessage,
  error,
  onRefresh,
  onRetrySave,
  onUpdate,
  onDelete,
  onCreate,
  onTrigger,
}: {
  automations: Automation[];
  followups: Followup[];
  systemAutomation: Automation | null;
  loading: boolean;
  saving: boolean;
  canRetrySave: boolean;
  triggeringId: string | null;
  triggerMessage: string | null;
  error: string | null;
  onRefresh: () => Promise<void> | void;
  onRetrySave: () => Promise<boolean> | void;
  onUpdate: (id: string, patch: Partial<Automation>) => void;
  onDelete: (id: string) => void;
  onCreate: (draft: Omit<Automation, 'id' | 'createdAt'>) => Promise<Automation | null> | void;
  onTrigger: (id: string) => void;
}): React.ReactElement {
  const [reports, setReports] = React.useState<WeChatReport[]>([]);
  const [reportsLoading, setReportsLoading] = React.useState(false);
  const [reportsError, setReportsError] = React.useState<string | null>(null);
  const hasDailySummary = automations.some((automation) => isDailySummaryAutomation(automation));
  const hasRunningReport = reports.some((report) => report.status === 'running');
  const triggeringAutomationName = triggeringId
    ? automations.find((automation) => automation.id === triggeringId)?.name ?? '自动化'
    : null;
  const loadReports = React.useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setReportsLoading(true);
    try {
      const res = await fetch('/api/apps/builtin/wechat/reports', { cache: 'no-store' });
      const json = (await res.json().catch(() => ({}))) as {
        reports?: unknown;
        error?: string;
        message?: string;
      };
      if (!res.ok || !Array.isArray(json.reports) || !json.reports.every(isWeChatReport)) {
        throw new Error(json.message ?? json.error ?? '报告加载失败');
      }
      setReports(json.reports);
      setReportsError(null);
    } catch (err) {
      setReportsError(err instanceof Error ? err.message : '报告加载失败');
    } finally {
      if (!options?.silent) setReportsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadReports();
  }, [loadReports, automations]);

  React.useEffect(() => {
    if (!triggerMessage) return;
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      void loadReports({ silent: true });
      void onRefresh();
      if (count >= 6) clearInterval(timer);
    }, 1500);
    return () => clearInterval(timer);
  }, [loadReports, onRefresh, triggerMessage]);

  React.useEffect(() => {
    if (!hasRunningReport) return;
    const timer = setInterval(() => {
      void loadReports({ silent: true });
      void onRefresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [hasRunningReport, loadReports, onRefresh]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">提醒与定期任务</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            规则会保存到本机；已接入调度的任务可以立即运行并查看执行记录。
          </p>
        </div>
        <div className="flex gap-2">
          {saving ? (
            <span className="inline-flex items-center gap-1 self-center text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              保存中
            </span>
          ) : null}
          <Button
            size="sm"
            onClick={() =>
              onCreate({
                name: '新提醒',
                kind: 'reminder_once',
                cron: '0 9 * * *',
                cronLabel: '明天 09:00',
                action: { kind: 'custom', messageTemplate: '提醒内容' },
                enabled: true,
                nextRunAt: nextMorningTs(),
              })
            }
          >
            <Plus className="size-3.5" />
            新建
          </Button>
        </div>
      </div>

      <SaveBanner
        saving={saving}
        canRetrySave={canRetrySave}
        error={error}
        onRetry={onRetrySave}
      />

      {error && !canRetrySave ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {triggerMessage ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
          <span>{triggerMessage}</span>
        </div>
      ) : null}

      {triggeringAutomationName ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" />
          <span>正在触发「{triggeringAutomationName}」，请等待它进入运行记录。</span>
        </div>
      ) : null}

      {!loading && !hasDailySummary ? (
        <BuiltinDailySummaryCard
          disabled={saving}
          onEnable={() =>
            onCreate({
              name: '每日微信总结',
              kind: 'reminder_recurring',
              cron: '0 21 * * *',
              cronLabel: '每天 21:00',
              action: {
                kind: 'wechat_summary',
                messageTemplate: '汇总今天微信消息，提炼重点、待办和需要跟进的人。',
              },
              enabled: true,
            })
          }
        />
      ) : null}

      {loading ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            加载自动化中…
          </CardContent>
        </Card>
      ) : automations.length === 0 && !systemAutomation ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
            还没有自动化任务
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {systemAutomation ? (
            <SystemAutomationRow automation={systemAutomation} />
          ) : null}
          {automations.map((a) => (
            <AutomationRow
              key={a.id}
              automation={a}
              followups={followups}
              triggering={triggeringId === a.id}
              triggerBlocked={Boolean(triggeringId && triggeringId !== a.id)}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onTrigger={onTrigger}
            />
          ))}
        </div>
      )}

      <RecentReports
        reports={reports}
        loading={reportsLoading}
        error={reportsError}
        onRefresh={loadReports}
      />
    </div>
  );
}

function SaveBanner({
  saving,
  canRetrySave,
  error,
  onRetry,
}: {
  saving: boolean;
  canRetrySave: boolean;
  error: string | null;
  onRetry: () => Promise<boolean> | void;
}) {
  if (!saving && !canRetrySave) return null;
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs',
        canRetrySave
          ? 'border border-destructive/30 bg-destructive/5 text-destructive'
          : 'border border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
      )}
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        {canRetrySave ? (
          <AlertCircle className="size-3.5 shrink-0" />
        ) : (
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
        )}
        <span className="min-w-0 break-words">
          {canRetrySave ? `保存失败：${error ?? '请重试保存。'}` : '保存中'}
        </span>
      </span>
      {canRetrySave ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void onRetry()}
          className="h-7 shrink-0 px-2 text-xs text-current hover:bg-current/10 hover:text-current"
        >
          <RefreshCw className="size-3.5" />
          重试保存
        </Button>
      ) : null}
    </div>
  );
}

function BuiltinDailySummaryCard({
  disabled,
  onEnable,
}: {
  disabled: boolean;
  onEnable: () => void;
}) {
  return (
    <Card className="border-emerald-500/25 bg-emerald-500/[0.03]">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
            <Sparkles className="size-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium">每日微信总结</h3>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                内置任务
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">
              每天 21:00 汇总本机微信消息，生成报告并发送系统通知。启用后会创建真实 Workflow 调度任务。
            </p>
          </div>
        </div>
        <Button size="sm" onClick={onEnable} disabled={disabled} className="shrink-0">
          启用
        </Button>
      </CardContent>
    </Card>
  );
}

function isWeChatReport(value: unknown): value is WeChatReport {
  if (!value || typeof value !== 'object') return false;
  const report = value as Partial<WeChatReport>;
  return (
    typeof report.id === 'string'
    && typeof report.automationId === 'string'
    && typeof report.automationName === 'string'
    && typeof report.scheduleId === 'string'
    && typeof report.runId === 'string'
    && (
      report.status === 'running'
      || report.status === 'success'
      || report.status === 'error'
      || report.status === 'cancelled'
    )
    && typeof report.startedAt === 'string'
    && (report.completedAt === null || typeof report.completedAt === 'string')
    && typeof report.summary === 'string'
    && typeof report.error === 'string'
    && typeof report.reportMarkdown === 'string'
    && typeof report.searchText === 'string'
    && (report.reportFileName === null || typeof report.reportFileName === 'string')
    && typeof report.detailAvailable === 'boolean'
  );
}

function RecentReports({
  reports,
  loading,
  error,
  onRefresh,
}: {
  reports: WeChatReport[];
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void> | void;
}) {
  const [query, setQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<WeChatReport['status'] | 'all'>('all');
  const [selectedReportId, setSelectedReportId] = React.useState<string | null>(null);
  const [deletingReportId, setDeletingReportId] = React.useState<string | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const selectedReport = React.useMemo(
    () => reports.find((report) => report.id === selectedReportId) ?? null,
    [reports, selectedReportId],
  );
  const filteredReports = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    return reports.filter((report) => {
      if (statusFilter !== 'all' && report.status !== statusFilter) return false;
      if (!needle) return true;
      return [
        report.automationName,
        report.summary,
        report.error,
        report.searchText,
        report.reportFileName ?? '',
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [query, reports, statusFilter]);
  const deleteReport = React.useCallback(async (report: WeChatReport) => {
    if (
      typeof window !== 'undefined'
      && !window.confirm(`删除报告「${report.automationName}」？删除后不会再出现在最近结果里。`)
    ) {
      return;
    }
    setDeletingReportId(report.id);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/apps/builtin/wechat/reports/${encodeURIComponent(report.id)}`, {
        method: 'DELETE',
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? '删除报告失败');
      if (selectedReportId === report.id) setSelectedReportId(null);
      await onRefresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : '删除报告失败');
    } finally {
      setDeletingReportId(null);
    }
  }, [onRefresh, selectedReportId]);

  return (
    <div className="flex flex-col gap-3 border-t pt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">最近结果</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            自动化运行后的摘要会先出现在这里；删除自动化后，已归档报告仍会保留。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void onRefresh()} disabled={loading}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
          刷新
        </Button>
      </div>

      {reports.length > 0 ? (
        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索报告、自动化名称或错误原因"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {([
              ['all', '全部'],
              ['success', '成功'],
              ['running', '运行中'],
              ['error', '失败'],
              ['cancelled', '取消'],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant={statusFilter === value ? 'default' : 'outline'}
                size="xs"
                onClick={() => setStatusFilter(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {deleteError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {deleteError}
        </div>
      ) : null}

      <div className="grid gap-3">
        {loading && reports.length === 0 ? (
          <div className="flex min-h-24 items-center justify-center gap-2 rounded-lg border border-dashed text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            加载运行结果中…
          </div>
        ) : null}
        {!loading && reports.length === 0 && !error ? (
          <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs leading-5 text-muted-foreground">
            还没有运行结果。启用“每日微信总结”后点击“立即运行”，报告会出现在这里。
          </div>
        ) : null}
        {filteredReports.length === 0 && reports.length > 0 ? (
          <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            没有匹配的运行结果
          </div>
        ) : null}
        {filteredReports.map((report) => (
          <Card key={report.id} className="border-border/70">
            <CardContent className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{report.automationName}</p>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px]', runStatusClass(report.status))}>
                      {runStatusLabel(report.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {formatReportTime(report.startedAt)}
                    {report.reportFileName ? ` · ${report.reportFileName}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1">
                  <ReportDownloadButton report={report} label="下载报告" variant="ghost" className="h-7 px-2 text-xs" />
                  {report.detailAvailable && report.scheduleId && report.runId ? (
                    <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                      <Link href={reportExecutionHref(report)}>
                        <ExternalLink className="size-3.5" />
                        打开执行记录
                      </Link>
                    </Button>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                      已归档
                    </span>
                  )}
                </div>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{report.error || report.summary}</p>
              {report.reportMarkdown ? (
                <pre className="max-h-32 max-w-full overflow-hidden rounded-lg bg-muted/30 p-3 text-[11px] leading-5 whitespace-pre-wrap break-words text-foreground [overflow-wrap:anywhere]">
                  {reportPreview(report.reportMarkdown)}
                </pre>
              ) : null}
              <div className="flex flex-wrap items-center justify-end gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setSelectedReportId(report.id)}
                >
                  <FileText className="size-3.5" />
                  查看报告
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                  disabled={deletingReportId === report.id}
                  onClick={() => void deleteReport(report)}
                >
                  {deletingReportId === report.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                  删除
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ReportDetailDialog
        report={selectedReport}
        open={Boolean(selectedReport)}
        deleting={selectedReport ? deletingReportId === selectedReport.id : false}
        onDelete={(report) => void deleteReport(report)}
        onOpenChange={(open) => {
          if (!open) setSelectedReportId(null);
        }}
      />
    </div>
  );
}

function ReportDetailDialog({
  report,
  open,
  deleting,
  onDelete,
  onOpenChange,
}: {
  report: WeChatReport | null;
  open: boolean;
  deleting: boolean;
  onDelete: (report: WeChatReport) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [fullMarkdown, setFullMarkdown] = React.useState<string | null>(null);
  const [fullMarkdownLoading, setFullMarkdownLoading] = React.useState(false);
  const [fullMarkdownError, setFullMarkdownError] = React.useState<string | null>(null);
  const fallbackBody = report ? report.reportMarkdown || report.error || report.summary || '暂无报告正文。' : '';
  const body = fullMarkdown || fallbackBody;

  React.useEffect(() => {
    if (!open || !report) {
      setFullMarkdown(null);
      setFullMarkdownLoading(false);
      setFullMarkdownError(null);
      return;
    }

    const ctrl = new AbortController();
    setFullMarkdown(null);
    setFullMarkdownError(null);
    setFullMarkdownLoading(true);
    void fetch(`/api/apps/builtin/wechat/reports/${encodeURIComponent(report.id)}/download`, {
      cache: 'no-store',
      signal: ctrl.signal,
    })
      .then(async (res) => {
        const text = await res.text();
        if (!res.ok) throw new Error(text || '完整报告加载失败');
        setFullMarkdown(text.trim() || fallbackBody);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setFullMarkdownError(err instanceof Error ? err.message : '完整报告加载失败');
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setFullMarkdownLoading(false);
      });

    return () => ctrl.abort();
  }, [fallbackBody, open, report]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!flex h-[85vh] max-h-[calc(100vh-2rem)] w-[min(920px,calc(100vw-2rem))] flex-col gap-4 overflow-hidden sm:max-w-none">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-base">
            <FileText className="size-4 shrink-0" />
            <span className="truncate">{report?.automationName ?? '自动化报告'}</span>
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {report ? (
              <>
                <span>{runStatusLabel(report.status)}</span>
                <span>·</span>
                <span>{formatReportTime(report.startedAt)}</span>
                {report.reportFileName ? (
                  <>
                    <span>·</span>
                    <span className="max-w-full truncate">{report.reportFileName}</span>
                  </>
                ) : null}
              </>
            ) : (
              '报告详情'
            )}
          </DialogDescription>
        </DialogHeader>

        {report?.summary || report?.error ? (
          <div
            className={cn(
              'rounded-lg border px-3 py-2 text-xs leading-5',
              report.error
                ? 'border-destructive/30 bg-destructive/5 text-destructive'
                : 'bg-muted/20 text-muted-foreground',
            )}
          >
            {report.error || report.summary}
          </div>
        ) : null}

        {fullMarkdownLoading || fullMarkdownError ? (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
            {fullMarkdownLoading ? <Loader2 className="size-3.5 animate-spin" /> : <AlertCircle className="size-3.5 text-amber-600" />}
            <span>
              {fullMarkdownLoading ? '正在加载完整报告…' : '完整报告加载失败，当前显示列表预览。'}
            </span>
          </div>
        ) : null}

        <div className="relative z-0 min-h-0 flex-1 overscroll-contain overflow-y-auto rounded-lg border bg-muted/20">
          <div className="min-w-0 p-4">
            <Streamdown
              className="prose prose-sm dark:prose-invert max-w-none break-words text-xs leading-relaxed [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_*]:max-w-full [&_code]:break-words [&_li]:break-words [&_p]:break-words [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto"
              plugins={markdownPlugins}
            >
              {body}
            </Streamdown>
          </div>
        </div>

        {report ? (
          <div className="relative z-10 flex shrink-0 flex-col-reverse gap-2 border-t bg-background pt-3 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={deleting}
              onClick={() => onDelete(report)}
            >
              {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              删除报告
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <ReportDownloadButton report={report} label="下载 Markdown" variant="outline" />
              {report.detailAvailable && report.scheduleId && report.runId ? (
                <Button asChild size="sm">
                  <Link
                    href={reportExecutionHref(report)}
                    onClick={() => onOpenChange(false)}
                  >
                    <ExternalLink className="size-3.5" />
                    打开执行记录
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ReportDownloadButton({
  report,
  label,
  variant,
  className,
}: {
  report: WeChatReport;
  label: string;
  variant: React.ComponentProps<typeof Button>['variant'];
  className?: string;
}) {
  const [downloading, setDownloading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const download = React.useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/builtin/wechat/reports/${encodeURIComponent(report.id)}/download`, {
        cache: 'no-store',
      });
      const text = await res.text();
      if (!res.ok) throw new Error(text || '报告下载失败');
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filenameFromDisposition(res.headers.get('content-disposition'))
        || report.reportFileName
        || `${safeReportName(report.automationName)}.md`;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '报告下载失败');
    } finally {
      setDownloading(false);
    }
  }, [report]);

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      className={className}
      disabled={downloading}
      title={error ?? undefined}
      onClick={() => void download()}
    >
      {downloading ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      {error ? '重试下载' : label}
    </Button>
  );
}

function SystemAutomationRow({ automation }: { automation: Automation }) {
  return (
    <Card className="ring-1 ring-foreground/5">
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-foreground">
            <Bell className="size-4" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <p className="text-sm font-medium">{automation.name}</p>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                系统
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              来自设置 · 分析频率 · {automation.cronLabel} · 不可删除
            </p>
          </div>
        </div>
        <p className="border-l-2 pl-3 text-[11px] leading-5 text-muted-foreground">
          {automation.action.kind === 'custom' ? automation.action.messageTemplate : ''}
        </p>
      </CardContent>
    </Card>
  );
}

function AutomationRow({
  automation,
  followups,
  triggering,
  triggerBlocked,
  onUpdate,
  onDelete,
  onTrigger,
}: {
  automation: Automation;
  followups: Followup[];
  triggering: boolean;
  triggerBlocked: boolean;
  onUpdate: (id: string, patch: Partial<Automation>) => void;
  onDelete: (id: string) => void;
  onTrigger: (id: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [minOneTimeRunAt] = React.useState(() => datetimeLocalValue(Date.now() + 60_000));
  const linkedFollowup =
    automation.followupId ? followups.find((f) => f.id === automation.followupId) ?? null : null;
  return (
    <Card
      className={cn(
        'transition-all hover:ring-1 hover:ring-foreground/15',
        !automation.enabled && 'opacity-60',
      )}
    >
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors',
                automation.enabled
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              <Bell className="size-4" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              {editing ? (
                <Input
                  value={automation.name}
                  onChange={(e) => onUpdate(automation.id, { name: e.target.value })}
                  className="h-7 px-1 text-sm"
                />
              ) : (
                <p className="text-sm font-medium">{automation.name}</p>
              )}
              <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted-foreground">
                <span>{kindLabel(automation.kind)}</span>
                <span>· {automation.cronLabel}</span>
                {linkedFollowup ? <span>· 跟进 「{linkedFollowup.title}」</span> : null}
                {automation.scheduleError ? (
                  <span className="text-amber-600">· 仅保存规则</span>
                ) : automation.scheduleId ? (
                  <span className="text-emerald-600">· 已接入调度</span>
                ) : null}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={automation.enabled}
              onCheckedChange={(enabled) => onUpdate(automation.id, { enabled })}
            />
            {automation.scheduleId && !automation.scheduleError ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onTrigger(automation.id)}
                  disabled={triggering || triggerBlocked}
                  title={triggerBlocked ? '已有自动化正在触发，请稍后再试' : undefined}
                  className="h-7 px-2 text-xs"
                >
                  {triggering ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                  {triggerBlocked ? '等待中' : '立即运行'}
                </Button>
                <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                  <Link href={`/workflow/schedules/${automation.scheduleId}`}>
                    <ExternalLink className="size-3.5" />
                    记录
                  </Link>
                </Button>
              </>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing((v) => !v)}
              className="h-7 px-2 text-xs"
            >
              {editing ? '收起' : '编辑'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(automation.id)}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-rose-600"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
        {editing ? (
          <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
            {automation.kind === 'reminder_once' ? (
              <Field label="执行时间">
                <Input
                  type="datetime-local"
                  value={datetimeLocalValue(automation.nextRunAt)}
                  min={minOneTimeRunAt}
                  onChange={(e) => {
                    const nextRunAt = parseDatetimeLocal(e.target.value);
                    if (!nextRunAt) return;
                    onUpdate(automation.id, {
                      nextRunAt,
                      cron: cronFromTimestamp(nextRunAt),
                      cronLabel: oneTimeLabel(nextRunAt),
                    });
                  }}
                />
              </Field>
            ) : (
              <RecurringScheduleEditor
                automation={automation}
                onUpdate={(patch) => onUpdate(automation.id, patch)}
              />
            )}
            <Field label="agent 提醒内容" className="sm:col-span-2">
              <Textarea
                value={automation.action.messageTemplate}
                onChange={(e) =>
                  onUpdate(automation.id, {
                    action: { ...automation.action, messageTemplate: e.target.value },
                  })
                }
                rows={2}
                className="resize-none text-sm"
              />
            </Field>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {automation.scheduleError
                ? automation.scheduleError
                : automation.lastRunAt
                  ? `上次 ${formatDateTime(automation.lastRunAt)}`
                  : '尚未触发'}
            </span>
            {automation.lastRunStatus ? (
              <span className={cn('rounded-full px-2 py-0.5', runStatusClass(automation.lastRunStatus))}>
                {runStatusLabel(automation.lastRunStatus)}
              </span>
            ) : null}
            {automation.latestRunId && automation.scheduleId ? (
              <Link
                href={`/workflow/schedules/${automation.scheduleId}/runs/${automation.latestRunId}`}
                className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
              >
                最新结果
                <ExternalLink className="size-3" />
              </Link>
            ) : null}
            {automation.lastRunError ? (
              <span className="max-w-full truncate text-destructive">{automation.lastRunError}</span>
            ) : null}
          </div>
          <span className="shrink-0">
            {automation.nextRunAt ? `下次 ${formatDateTime(automation.nextRunAt)}` : ''}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

type RecurringScheduleMode = 'daily' | 'weekly' | 'hourly' | 'custom';

interface RecurringScheduleConfig {
  mode: RecurringScheduleMode;
  time: string;
  weekday: string;
  intervalHours: number;
}

function RecurringScheduleEditor({
  automation,
  onUpdate,
}: {
  automation: Automation;
  onUpdate: (patch: Partial<Automation>) => void;
}) {
  const config = parseRecurringScheduleConfig(automation.cron);
  const applyMode = (mode: RecurringScheduleMode) => {
    if (mode === 'custom') return;
    onUpdate(buildRecurringPatch({
      mode,
      time: config.time,
      weekday: config.weekday,
      intervalHours: config.intervalHours,
    }));
  };
  const applyTime = (time: string) => {
    if (!parseTimeParts(time) || config.mode === 'custom' || config.mode === 'hourly') return;
    onUpdate(buildRecurringPatch({ ...config, time }));
  };
  const applyWeekday = (weekday: string) => {
    if (config.mode !== 'weekly') return;
    onUpdate(buildRecurringPatch({ ...config, weekday }));
  };
  const applyInterval = (value: string) => {
    const intervalHours = Math.max(1, Math.min(24, Number(value) || 1));
    onUpdate(buildRecurringPatch({ ...config, mode: 'hourly', intervalHours }));
  };

  return (
    <>
      <Field label="重复频率">
        <Select value={config.mode} onValueChange={(value) => applyMode(value as RecurringScheduleMode)}>
          <SelectTrigger className="h-9 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="daily">每天</SelectItem>
              <SelectItem value="weekly">每周</SelectItem>
              <SelectItem value="hourly">每 N 小时</SelectItem>
              {config.mode === 'custom' ? <SelectItem value="custom">高级规则</SelectItem> : null}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      {config.mode === 'daily' || config.mode === 'weekly' ? (
        <Field label="执行时间">
          <Input
            type="time"
            value={config.time}
            onChange={(event) => applyTime(event.target.value)}
            className="tabular-nums"
          />
        </Field>
      ) : null}

      {config.mode === 'weekly' ? (
        <Field label="星期">
          <Select value={config.weekday} onValueChange={applyWeekday}>
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {WEEKDAY_OPTIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      ) : null}

      {config.mode === 'hourly' ? (
        <Field label="间隔小时">
          <Input
            type="number"
            min={1}
            max={24}
            value={config.intervalHours}
            onChange={(event) => applyInterval(event.target.value)}
            className="tabular-nums"
          />
        </Field>
      ) : null}

      {config.mode === 'custom' ? (
        <>
          <Field label="高级 cron">
            <Input
              value={automation.cron}
              onChange={(event) => onUpdate({ cron: event.target.value })}
              className="font-mono text-xs"
            />
          </Field>
          <Field label="展示文案">
            <Input
              value={automation.cronLabel}
              onChange={(event) => onUpdate({ cronLabel: event.target.value })}
            />
          </Field>
        </>
      ) : (
        <div className="flex items-center rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground sm:col-span-2">
          将保存为：{automation.cronLabel}
        </div>
      )}
    </>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function kindLabel(kind: AutomationKind): string {
  return kind === 'reminder_once' ? '一次性' : '定期';
}

function isDailySummaryAutomation(automation: Automation): boolean {
  if (automation.action.kind === 'wechat_summary') return true;
  return /每日微信总结|微信总结|微信日报/.test(`${automation.name}\n${automation.action.messageTemplate}`);
}

function runStatusLabel(status: Automation['lastRunStatus']): string {
  if (status === 'running') return '运行中';
  if (status === 'success') return '成功';
  if (status === 'error') return '失败';
  if (status === 'cancelled') return '已取消';
  return '';
}

function runStatusClass(status: Automation['lastRunStatus']): string {
  if (status === 'running') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'success') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'error') return 'bg-destructive/10 text-destructive';
  if (status === 'cancelled') return 'bg-muted text-muted-foreground';
  return 'bg-muted text-muted-foreground';
}

function formatReportTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return iso;
  return formatDateTime(ts);
}

const WEEKDAY_OPTIONS = [
  { value: '1', label: '周一' },
  { value: '2', label: '周二' },
  { value: '3', label: '周三' },
  { value: '4', label: '周四' },
  { value: '5', label: '周五' },
  { value: '6', label: '周六' },
  { value: '0', label: '周日' },
] as const;

function parseRecurringScheduleConfig(cron: string): RecurringScheduleConfig {
  const fallback: RecurringScheduleConfig = {
    mode: 'custom',
    time: '09:00',
    weekday: '1',
    intervalHours: 4,
  };
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return fallback;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*' && isCronMinute(minute) && isCronHour(hour)) {
    return {
      mode: 'daily',
      time: formatClock(Number(hour), Number(minute)),
      weekday: '1',
      intervalHours: 4,
    };
  }
  if (dayOfMonth === '*' && month === '*' && isCronMinute(minute) && isCronHour(hour) && /^[0-6]$/.test(dayOfWeek)) {
    return {
      mode: 'weekly',
      time: formatClock(Number(hour), Number(minute)),
      weekday: dayOfWeek,
      intervalHours: 4,
    };
  }
  const hourStep = /^\*\/(\d{1,2})$/.exec(hour);
  if (isCronMinute(minute) && hourStep && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return {
      mode: 'hourly',
      time: formatClock(9, Number(minute)),
      weekday: '1',
      intervalHours: Math.max(1, Math.min(24, Number(hourStep[1]) || 4)),
    };
  }
  return fallback;
}

function buildRecurringPatch(config: RecurringScheduleConfig): Partial<Automation> {
  if (config.mode === 'weekly') {
    const time = parseTimeParts(config.time) ?? { hour: 9, minute: 0 };
    const weekday = /^[0-6]$/.test(config.weekday) ? config.weekday : '1';
    const label = `每${weekdayText(weekday)} ${formatClock(time.hour, time.minute)}`;
    return {
      kind: 'reminder_recurring',
      cron: `${time.minute} ${time.hour} * * ${weekday}`,
      cronLabel: label,
    };
  }
  if (config.mode === 'hourly') {
    const intervalHours = Math.max(1, Math.min(24, Number(config.intervalHours) || 1));
    return {
      kind: 'reminder_recurring',
      cron: `0 */${intervalHours} * * *`,
      cronLabel: `每 ${intervalHours} 小时`,
    };
  }
  const time = parseTimeParts(config.time) ?? { hour: 9, minute: 0 };
  return {
    kind: 'reminder_recurring',
    cron: `${time.minute} ${time.hour} * * *`,
    cronLabel: `每天 ${formatClock(time.hour, time.minute)}`,
  };
}

function parseTimeParts(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function formatClock(hour: number, minute: number): string {
  return `${pad2(Math.max(0, Math.min(23, hour)))}:${pad2(Math.max(0, Math.min(59, minute)))}`;
}

function isCronMinute(value: string): boolean {
  if (!/^\d{1,2}$/.test(value)) return false;
  const num = Number(value);
  return num >= 0 && num <= 59;
}

function isCronHour(value: string): boolean {
  if (!/^\d{1,2}$/.test(value)) return false;
  const num = Number(value);
  return num >= 0 && num <= 23;
}

function weekdayText(value: string): string {
  return WEEKDAY_OPTIONS.find((item) => item.value === value)?.label ?? '周一';
}

function nextMorningTs(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

function datetimeLocalValue(ts?: number): string {
  if (!ts) return '';
  const date = new Date(ts);
  if (!Number.isFinite(date.getTime())) return '';
  return [
    date.getFullYear(),
    '-',
    pad2(date.getMonth() + 1),
    '-',
    pad2(date.getDate()),
    'T',
    pad2(date.getHours()),
    ':',
    pad2(date.getMinutes()),
  ].join('');
}

function parseDatetimeLocal(value: string): number | null {
  if (!value.trim()) return null;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function oneTimeLabel(ts: number): string {
  const date = new Date(ts);
  return [
    date.getFullYear(),
    '-',
    pad2(date.getMonth() + 1),
    '-',
    pad2(date.getDate()),
    ' ',
    pad2(date.getHours()),
    ':',
    pad2(date.getMinutes()),
  ].join('');
}

function cronFromTimestamp(ts: number): string {
  const date = new Date(ts);
  return `${date.getMinutes()} ${date.getHours()} * * *`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
