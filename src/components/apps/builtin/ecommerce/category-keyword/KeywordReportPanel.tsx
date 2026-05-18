'use client';

import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, Copy, Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { STATUS_LABEL, isNonTerminal, type RunStatus } from './run-status';

export interface ReportRun {
  id: string;
  status: RunStatus;
  progress: number;
  category_label: string;
  summary: string;
  error: string | null;
}

function safeFilePart(s: string): string {
  return (s.replace(/[^\w一-龥-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)) || 'report';
}

/**
 * 报告面板（纯展示）：运行中显实时进度；终态有报告则渲染 GFM Markdown 并
 * 提供复制/下载（最终交付物可带走，去「选品」继续）；无报告则如实说明。
 */
export function KeywordReportPanel({
  run,
  reportMd,
}: {
  run: ReportRun | null;
  reportMd: string | null;
}): React.ReactElement | null {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => setCopied(false), [run?.id]);
  if (!run) return null;
  const live = isNonTerminal(run.status);

  const handleCopy = async (): Promise<void> => {
    if (!reportMd) return;
    try {
      await navigator.clipboard.writeText(reportMd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard 不可用时静默（不阻断阅读） */
    }
  };

  const handleDownload = (): void => {
    if (!reportMd) return;
    // 与项目既有规范（ResearchTab/ListingsTab）一致：anchor 必须挂载到 DOM
    // 再 click，部分浏览器对游离 anchor 的合成 click 不触发下载。
    const blob = new Blob([reportMd], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `关键词调研-${safeFilePart(run.category_label)}-${run.id.slice(0, 8)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 py-3">
        <div className="min-w-0">
          <CardTitle className="text-sm">关键词分析报告</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            关键词=Etsy listing 标签，搜索量/竞争度来自 EHunt 逐 tag hover。EHunt
            未就绪的类目会如实标注原因（不伪造）。
          </p>
        </div>
        {!live && reportMd ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => void handleCopy()}>
              <Copy className="size-3.5" />
              <span className="ml-1">{copied ? '已复制' : '复制'}</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDownload}>
              <Download className="size-3.5" />
              <span className="ml-1">下载 .md</span>
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {live ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            <span>
              {STATUS_LABEL[run.status]} · {run.progress}%
              {run.summary ? ` · ${run.summary}` : ''}
              （完成后自动显示报告）
            </span>
          </div>
        ) : reportMd ? (
          <div className="prose prose-sm max-h-[68vh] max-w-none overflow-auto rounded-md bg-muted/20 p-4 dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{reportMd}</ReactMarkdown>
          </div>
        ) : (
          <p className="py-6 text-sm text-muted-foreground">
            {run.status === 'cancelled' || run.status === 'failed'
              ? `任务${STATUS_LABEL[run.status]}，未产出报告。${run.error ?? ''}`
              : '（报告尚未生成）'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
