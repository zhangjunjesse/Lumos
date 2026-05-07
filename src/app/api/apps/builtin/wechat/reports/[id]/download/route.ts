import { NextResponse } from 'next/server';

import { getArchivedWeChatAutomationReport } from '@/lib/wechat-assistant/report-archive';
import { listWeChatAutomationReports, type WeChatAutomationReport } from '@/lib/wechat-assistant/reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };
type DownloadableReport = NonNullable<ReturnType<typeof getArchivedWeChatAutomationReport>> | WeChatAutomationReport;

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const report = getArchivedWeChatAutomationReport(id)
    ?? (await listWeChatAutomationReports()).find((item) => item.id === id)
    ?? null;
  if (!report) {
    return NextResponse.json({ error: 'report_not_found' }, { status: 404 });
  }

  const markdown = report.reportMarkdown.trim() || buildFallbackMarkdown(report);
  const filename = `${safeFilename(report.automationName)}-${dateSlug(report.startedAt)}.md`;

  return new NextResponse(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}

function buildFallbackMarkdown(report: DownloadableReport): string {
  return [
    `# ${report.automationName}`,
    '',
    `生成时间：${formatTime(report.startedAt)}`,
    `状态：${report.status}`,
    '',
    report.error || report.summary || '暂无报告正文。',
  ].join('\n');
}

function safeFilename(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return (cleaned || 'wechat-report').slice(0, 80);
}

function dateSlug(value: string): string {
  const ts = new Date(value);
  if (!Number.isFinite(ts.getTime())) return 'unknown-time';
  return ts.toISOString().slice(0, 16).replace(/[-:T]/g, '');
}

function formatTime(value: string): string {
  const ts = new Date(value);
  if (!Number.isFinite(ts.getTime())) return value || '未知时间';
  return ts.toLocaleString('zh-CN');
}
