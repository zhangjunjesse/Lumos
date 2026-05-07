import type { WeChatReport } from './automations-types';

export function reportExecutionHref(report: Pick<WeChatReport, 'scheduleId' | 'runId'>): string {
  return `/workflow/schedules/${encodeURIComponent(report.scheduleId)}/runs/${encodeURIComponent(report.runId)}`;
}

export function reportPreview(markdown: string): string {
  const normalized = markdown.trim();
  if (normalized.length <= 900) return normalized;
  return `${normalized.slice(0, 900).trimEnd()}\n...`;
}

export function filenameFromDisposition(value: string | null): string | null {
  if (!value) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      return utf8[1];
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(value);
  return plain?.[1] ?? null;
}

export function safeReportName(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|#%&{}$!'@+`=]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    || 'wechat-report';
}
