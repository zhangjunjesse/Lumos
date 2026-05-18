'use client';

import * as React from 'react';
import { Download, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { WeChatReport } from './automations-types';
import { filenameFromDisposition, safeReportName } from './report-ui';

export function ReportDownloadButton({
  report,
  label,
  variant,
  className,
}: {
  report: WeChatReport;
  label: string;
  variant: React.ComponentProps<typeof Button>['variant'];
  className?: string;
}): React.ReactElement {
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
