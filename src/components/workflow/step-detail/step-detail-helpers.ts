import type { WorkflowDslStepOverlay } from '../WorkflowDslGraph';
import type { WorkflowNode } from '@/lib/workflow/types-v3';

export const TYPE_LABEL: Record<WorkflowNode['type'], string> = {
  agent: 'Agent',
  wait: 'Wait',
  'if-else': 'If / Else',
  'for-each': 'For Each',
  while: 'While',
  notification: 'Notification',
  capability: 'Capability',
  parallel: 'Parallel',
  join: 'Join',
  approval: 'Approval',
};

export const STATUS_LABEL: Record<WorkflowDslStepOverlay['status'], string> = {
  pending: '待执行',
  running: '运行中',
  success: '成功',
  error: '失败',
  skipped: '跳过',
};

export const STATUS_CLS: Record<WorkflowDslStepOverlay['status'], string> = {
  pending: 'bg-slate-500/10 text-slate-700 border-slate-500/20',
  running: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  success: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  error: 'bg-red-500/10 text-red-700 border-red-500/20',
  skipped: 'bg-slate-400/10 text-slate-600 border-slate-400/20',
};

/** 与顶层已呈现的字段重复,不要再在 "其他配置" 里展示。 */
export const SURFACED_INPUT_KEYS = new Set([
  'preset', 'prompt', 'expectedOutput', 'model', 'role',
  'condition', 'body', 'then', 'else',
  'collection', 'maxIterations', 'mode', 'durationMs',
]);

export function fmtDuration(ms: number | null): string {
  if (typeof ms !== 'number' || ms <= 0) return '--';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

export function fmtTimeout(ms?: number): string {
  if (typeof ms !== 'number' || ms <= 0) return '--';
  return ms >= 60_000 ? `${Math.round(ms / 60_000)} 分钟` : `${Math.round(ms / 1000)} 秒`;
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function getString(obj: Record<string, unknown> | undefined, key: string): string | null {
  const v = obj?.[key];
  return typeof v === 'string' && v ? v : null;
}

export function formatCondition(c: unknown): string {
  if (!c || typeof c !== 'object') return '--';
  return JSON.stringify(c, null, 2);
}

export function readInput(node: WorkflowNode): Record<string, unknown> {
  if (node.type === 'join') return {};
  return (node.input ?? {}) as Record<string, unknown>;
}
