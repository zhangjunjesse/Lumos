'use client';

import * as React from 'react';
import Link from 'next/link';
import { cjk } from '@streamdown/cjk';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import { AlertCircle, ExternalLink, FileText, Loader2, Trash2 } from 'lucide-react';
import { Streamdown } from 'streamdown';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { streamdownCode } from '@/lib/streamdown-code';
import { cn } from '@/lib/utils';

import type { WeChatReport } from './automations-types';
import { formatReportTime, runStatusLabel } from './automation-format';
import { ReportDownloadButton } from './ReportDownloadButton';
import { reportExecutionHref } from './report-ui';

const markdownPlugins = { cjk, code: streamdownCode, math, mermaid };

export function ReportDetailDialog({
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
}): React.ReactElement {
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
