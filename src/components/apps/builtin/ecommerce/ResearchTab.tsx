'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  CircleX,
  Copy,
  Download,
  FileText,
  Loader2,
  Printer,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { ResearchReport, ResearchReportStatus } from './types';
import { clusterReportsByBatch, parsePlatformInput } from './research-batch';
import { openReportPrintWindow } from './research-pdf-export';

interface ResearchTabProps {
  reports: ResearchReport[];
  loading: boolean;
  refreshing: boolean;
  onChanged: () => void;
}

const PRESET_PLATFORMS = ['etsy', 'amazon', 'taobao', 'goofish', 'douyin', 'general'];

type ResearchSubTab = 'tasks' | 'reports';

export function ResearchTab({
  reports,
  loading,
  refreshing,
  onChanged,
}: ResearchTabProps): React.ReactElement {
  const [subTab, setSubTab] = React.useState<ResearchSubTab>('tasks');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const completedReports = React.useMemo(
    () => reports.filter((r) => r.status === 'completed'),
    [reports],
  );

  const handleOpenReport = (id: string) => {
    setSelectedId(id);
    setSubTab('reports');
  };

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={subTab}
        onValueChange={(v) => setSubTab(v as ResearchSubTab)}
        className="min-h-0 flex-1"
      >
        <TabsList className="bg-muted/40">
          <TabsTrigger value="tasks">
            调研任务列表
            <span className="ml-2 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
              {reports.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="reports">
            调研报告
            <span className="ml-2 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
              {completedReports.length}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="mt-3">
          <TasksPanel
            reports={reports}
            loading={loading}
            refreshing={refreshing}
            onChanged={onChanged}
            onOpenReport={handleOpenReport}
          />
        </TabsContent>

        <TabsContent value="reports" className="mt-3">
          <ReportsPanel
            reports={completedReports}
            loading={loading}
            refreshing={refreshing}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChanged={onChanged}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------- 调研任务列表 ----------

function TasksPanel({
  reports,
  loading,
  refreshing,
  onChanged,
  onOpenReport,
}: {
  reports: ResearchReport[];
  loading: boolean;
  refreshing: boolean;
  onChanged: () => void;
  onOpenReport: (id: string) => void;
}): React.ReactElement {
  const [dialogOpen, setDialogOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">任务列表</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {refreshing ? '同步中…' : `${reports.length} 条`}
            </span>
            <Button
              size="sm"
              onClick={() => setDialogOpen(true)}
              data-testid="new-research-task"
            >
              <Sparkles className="size-3.5" />
              新建任务
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading && reports.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
          ) : reports.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              还没有调研任务。先在上方提交一条。
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {clusterReportsByBatch(reports).map((batch) =>
                batch.reports.length > 1 ? (
                  <li
                    key={batch.key}
                    className="rounded-md border border-dashed border-foreground/20 bg-muted/20 p-2"
                  >
                    <p className="mb-2 text-[11px] font-medium text-muted-foreground">
                      📦 批次 · {batch.query} · {batch.reports.length} 个平台
                    </p>
                    <ul className="flex flex-col gap-2">
                      {batch.reports.map((report) => (
                        <TaskRow
                          key={report.id}
                          report={report}
                          onOpenReport={onOpenReport}
                          onChanged={onChanged}
                        />
                      ))}
                    </ul>
                  </li>
                ) : (
                  <TaskRow
                    key={batch.reports[0].id}
                    report={batch.reports[0]}
                    onOpenReport={onOpenReport}
                    onChanged={onChanged}
                  />
                ),
              )}
            </ul>
          )}
        </CardContent>
      </Card>

      <NewTaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={() => {
          setDialogOpen(false);
          onChanged();
        }}
      />
    </div>
  );
}

function NewTaskDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}): React.ReactElement {
  const [platform, setPlatform] = React.useState('etsy');
  const [query, setQuery] = React.useState('');
  const [instruction, setInstruction] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset form whenever the dialog closes so the next open starts clean.
  React.useEffect(() => {
    if (!open) {
      setQuery('');
      setInstruction('');
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) {
      setError('请填写调研指令');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const platforms = parsePlatformInput(platform);
      const targets = platforms.length > 0 ? platforms : ['general'];
      const responses = await Promise.allSettled(
        targets.map((p) =>
          fetch('/api/apps/builtin/ecommerce/research', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              platform: p,
              query: query.trim(),
              instruction: instruction.trim() || undefined,
            }),
          }).then(async (res) => {
            const json = (await res.json().catch(() => ({}))) as {
              error?: string;
              report?: ResearchReport;
            };
            if (!res.ok || !json.report) throw new Error(json.error ?? '提交失败');
            return json.report;
          }),
        ),
      );
      const created = responses
        .filter((r): r is PromiseFulfilledResult<ResearchReport> => r.status === 'fulfilled')
        .map((r) => r.value);
      const failed = responses
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
      if (created.length === 0) {
        throw new Error(failed[0] ?? '提交失败');
      }
      if (failed.length > 0) {
        // Some platforms succeeded, some failed — surface the partial failure
        // but still close the dialog so the user can see what landed.
        setError(`部分平台提交失败：${failed.join('; ')}`);
        setSubmitting(false);
        return;
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建调研任务</DialogTitle>
          <DialogDescription>
            选定平台 + 调研指令后启动；可以同时下发多个平台并行调研。完成后会出现在「调研报告」子 tab。
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="research-platform">目标平台</Label>
            <Input
              id="research-platform"
              list="research-platform-presets"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              placeholder="etsy 或 etsy, amazon, walmart"
              autoFocus
            />
            <datalist id="research-platform-presets">
              {PRESET_PLATFORMS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <p className="text-[10px] text-muted-foreground">
              逗号/空格隔开可并行多平台（最多 6 个）。
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="research-query">调研指令 *</Label>
            <Input
              id="research-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例：手作陶瓷杯，价格带 25-45 USD，最近 30 天热门 listing"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="research-instruction">附加约束（可选）</Label>
            <Textarea
              id="research-instruction"
              rows={3}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="例：重点看包装、礼物属性；忽略 dropshipping"
            />
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              启动调研
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaskRow({
  report,
  onOpenReport,
  onChanged,
}: {
  report: ResearchReport;
  onOpenReport: (id: string) => void;
  onChanged: () => void;
}): React.ReactElement {
  const [busy, setBusy] = React.useState<'cancel' | 'delete' | 'rerun' | null>(null);
  const [rowError, setRowError] = React.useState<string | null>(null);

  const callCancel = async () => {
    setBusy('cancel');
    setRowError(null);
    try {
      const res = await fetch(`/api/apps/builtin/ecommerce/research/${report.id}/cancel`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('取消失败');
      onChanged();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : '取消失败');
    } finally {
      setBusy(null);
    }
  };

  const callRerun = async () => {
    setBusy('rerun');
    setRowError(null);
    try {
      const res = await fetch('/api/apps/builtin/ecommerce/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: report.platform,
          query: report.query,
          instruction: report.instruction ?? undefined,
        }),
      });
      if (!res.ok) throw new Error('重新跑失败');
      onChanged();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : '重新跑失败');
    } finally {
      setBusy(null);
    }
  };

  const callDelete = async () => {
    if (typeof window !== 'undefined' && !window.confirm(`删除任务「${report.summary ?? report.query}」？会同时删除磁盘 md。`)) return;
    setBusy('delete');
    setRowError(null);
    try {
      const res = await fetch(`/api/apps/builtin/ecommerce/research/${report.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('删除失败');
      onChanged();
    } catch (err) {
      setRowError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusy(null);
    }
  };

  const isLive = report.status === 'queued' || report.status === 'running';

  return (
    <li className="rounded-md border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onOpenReport(report.id)}
          className="flex-1 text-left"
        >
          <p className="text-sm font-medium">
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase">
              {report.platform}
            </span>{' '}
            {report.query}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <StatusBadge status={report.status} />
            {report.stage ? ` · ${report.stage}` : ''}
            {typeof report.progress === 'number' ? ` · ${report.progress}%` : ''}
            {report.summary ? ` · ${report.summary}` : ''}
            {report.word_count ? ` · ${report.word_count} 字` : ''}
            {report.created_at ? ` · ${formatRelativeTime(report.created_at)}` : ''}
          </p>
        </button>
        <div className="flex shrink-0 gap-1">
          {report.status === 'completed' ? (
            <Button size="sm" variant="ghost" onClick={() => onOpenReport(report.id)}>
              <FileText className="size-3.5" />
              查看报告
            </Button>
          ) : null}
          {isLive ? (
            <Button size="sm" variant="ghost" onClick={callCancel} disabled={busy !== null}>
              <CircleX className="size-3.5" />
              取消
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={callRerun} disabled={busy !== null} title="基于同样的平台和指令再跑一次">
              <RotateCcw className="size-3.5" />
              重新跑
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={callDelete} disabled={busy !== null}>
            <Trash2 className="size-3.5" />
            删除
          </Button>
        </div>
      </div>
      {report.error ? (
        <p className="mt-1 text-xs text-destructive">失败原因：{report.error}</p>
      ) : null}
      {rowError ? <p className="mt-1 text-xs text-destructive">{rowError}</p> : null}
    </li>
  );
}

// ---------- 调研报告（md 预览 + 导出 PDF）----------

function ReportsPanel({
  reports,
  loading,
  refreshing,
  selectedId,
  onSelect,
  onChanged,
}: {
  reports: ResearchReport[];
  loading: boolean;
  refreshing: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => void;
}): React.ReactElement {
  React.useEffect(() => {
    if (!selectedId && reports.length > 0) {
      onSelect(reports[0].id);
    }
    if (selectedId && !reports.some((r) => r.id === selectedId)) {
      onSelect(reports[0]?.id ?? null);
    }
  }, [selectedId, reports, onSelect]);

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card className="lg:max-h-[calc(80vh-2rem)] lg:overflow-y-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">已完成报告</CardTitle>
          <span className="text-xs text-muted-foreground">
            {refreshing ? '同步中…' : `${reports.length} 份`}
          </span>
        </CardHeader>
        <CardContent>
          {loading && reports.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">加载中…</p>
          ) : reports.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              还没有完成的报告。到「调研任务列表」启动一个。
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {reports.map((report) => (
                <li key={report.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(report.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                      selectedId === report.id
                        ? 'border-foreground/40 bg-muted/60'
                        : 'hover:bg-muted/30'
                    }`}
                  >
                    <p className="text-xs font-medium">
                      <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] uppercase">
                        {report.platform}
                      </span>{' '}
                      {report.query}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {report.word_count ? `${report.word_count} 字` : ''}
                      {report.completed_at ? ` · ${formatRelativeTime(report.completed_at)}` : ''}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="min-h-[40vh]">
        {selectedId ? (
          <ReportPreview key={selectedId} id={selectedId} onChanged={onChanged} />
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              在左侧选择一份已完成报告查看内容。
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function ReportPreview({
  id,
  onChanged,
}: {
  id: string;
  onChanged: () => void;
}): React.ReactElement {
  const [loading, setLoading] = React.useState(true);
  const [markdown, setMarkdown] = React.useState('');
  const [report, setReport] = React.useState<ResearchReport | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const renderedHtmlRef = React.useRef<HTMLDivElement | null>(null);

  const fetchOne = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/apps/builtin/ecommerce/research/${id}`, {
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => ({}))) as {
        report?: ResearchReport;
        markdown?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? '加载失败');
      setReport(json.report ?? null);
      setMarkdown(json.markdown ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  React.useEffect(() => {
    void fetchOne();
  }, [fetchOne]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safePlatform = (report?.platform ?? 'report').replace(/[^a-z0-9-]+/gi, '-');
    const safeQuery = (report?.query ?? id).slice(0, 40).replace(/[^一-龥a-z0-9-_]+/gi, '_');
    a.href = url;
    a.download = `${safePlatform}-${safeQuery}-${id.slice(0, 8)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    const html = renderedHtmlRef.current?.innerHTML ?? '';
    if (!html) return;
    const title = `${report?.platform ?? ''} 调研报告：${report?.query ?? id}`.trim();
    openReportPrintWindow({
      title,
      bodyHtml: html,
      meta: {
        平台: report?.platform ?? null,
        指令: report?.query ?? null,
        附加约束: report?.instruction ?? null,
        生成时间: report?.completed_at ?? report?.updated_at ?? null,
        字数: report?.word_count != null ? String(report.word_count) : null,
      },
    });
  };

  const handleDelete = async () => {
    if (typeof window !== 'undefined' && !window.confirm('删除这份报告？磁盘 md 也会被移除。')) return;
    try {
      const res = await fetch(`/api/apps/builtin/ecommerce/research/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('删除失败');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">
          {report
            ? `${report.platform} · ${report.query}`
            : '报告详情'}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={fetchOne} disabled={loading}>
            <RefreshCw className="size-3.5" />
            刷新
          </Button>
          <Button size="sm" variant="ghost" onClick={handleCopy} disabled={!markdown}>
            <Copy className="size-3.5" />
            {copied ? '已复制' : '复制 markdown'}
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDownload} disabled={!markdown}>
            <Download className="size-3.5" />
            下载 .md
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleExportPdf}
            disabled={!markdown}
            data-testid="research-export-pdf"
          >
            <Printer className="size-3.5" />
            导出 PDF
          </Button>
          <Button size="sm" variant="ghost" onClick={handleDelete} disabled={!report}>
            <Trash2 className="size-3.5" />
            删除
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : loading && !markdown ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : markdown ? (
          <div
            ref={renderedHtmlRef}
            data-testid="research-report-markdown"
            className="prose prose-sm dark:prose-invert max-h-[68vh] max-w-none overflow-auto rounded-md bg-muted/20 p-4"
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children, ...rest }) => (
                  <a
                    {...rest}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline decoration-blue-400/40 hover:decoration-blue-500 dark:text-blue-400"
                  >
                    {children}
                  </a>
                ),
              }}
            >
              {markdown}
            </ReactMarkdown>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            报告尚未生成（当前状态：{report?.status ?? '未知'}{report?.stage ? ` · ${report.stage}` : ''}）
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- shared bits ----------

function StatusBadge({ status }: { status: ResearchReportStatus }): React.ReactElement {
  const map: Record<ResearchReportStatus, { label: string; cls: string }> = {
    queued: { label: '排队', cls: 'bg-muted text-muted-foreground' },
    running: { label: '运行中', cls: 'bg-blue-500/10 text-blue-700 dark:text-blue-300' },
    completed: { label: '完成', cls: 'bg-green-500/10 text-green-700 dark:text-green-300' },
    failed: { label: '失败', cls: 'bg-destructive/10 text-destructive' },
    cancelled: { label: '已取消', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  };
  const v = map[status];
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${v.cls}`}>
      {v.label}
    </span>
  );
}

function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(t).toLocaleDateString('zh-CN');
}
