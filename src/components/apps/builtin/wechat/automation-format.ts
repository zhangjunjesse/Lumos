/**
 * 自动化运行状态 / 报告的纯展示映射与类型守卫。无 JSX。
 * 从旧 AutomationsTab.tsx 拆出（CLAUDE.md：单文件 ≤300 行、关注点分离）。
 */
import type { WeChatReport } from './automations-types';
import { formatDateTime } from './wechat-types';
import type { Automation } from './relations-types';

export function runStatusLabel(status: Automation['lastRunStatus'] | WeChatReport['status']): string {
  if (status === 'running') return '运行中';
  if (status === 'success') return '成功';
  if (status === 'error') return '失败';
  if (status === 'cancelled') return '已取消';
  return '';
}

export function runStatusClass(status: Automation['lastRunStatus'] | WeChatReport['status']): string {
  if (status === 'running') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'success') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'error') return 'bg-destructive/10 text-destructive';
  if (status === 'cancelled') return 'bg-muted text-muted-foreground';
  return 'bg-muted text-muted-foreground';
}

export function formatReportTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return iso;
  return formatDateTime(ts);
}

export function isWeChatReport(value: unknown): value is WeChatReport {
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
