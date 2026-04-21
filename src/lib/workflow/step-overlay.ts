export type StepOverlayStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export interface WorkflowDslStepOverlay {
  status: StepOverlayStatus;
  durationMs: number | null;
  outputFileCount: number;
  outputSummary: string;
  error: string;
  /**
   * Current retry attempt in a live run (1-based). Only populated while a step
   * is actively retrying — cleared on completion. Pair with `maxAttempts` to
   * render the "N/M" indicator.
   */
  attempt?: number;
  maxAttempts?: number;
}

export interface StepAggregateOverlay {
  total: number;
  pending: number;
  running: number;
  success: number;
  error: number;
  skipped: number;
}

export function statusOf(overlay: WorkflowDslStepOverlay | undefined): StepOverlayStatus | null {
  return overlay ? overlay.status : null;
}

export function aggregateOf(
  descendantIds: string[],
  overlays: Record<string, WorkflowDslStepOverlay> | undefined,
): StepAggregateOverlay | null {
  if (!overlays || descendantIds.length === 0) return null;
  const agg: StepAggregateOverlay = {
    total: 0, pending: 0, running: 0, success: 0, error: 0, skipped: 0,
  };
  let hasAny = false;
  for (const id of descendantIds) {
    const o = overlays[id];
    if (!o) continue;
    hasAny = true;
    agg.total += 1;
    agg[o.status] += 1;
  }
  return hasAny ? agg : null;
}

export function aggregateStatus(agg: StepAggregateOverlay): StepOverlayStatus {
  if (agg.error > 0) return 'error';
  if (agg.running > 0) return 'running';
  if (agg.total > 0 && agg.success + agg.skipped === agg.total) return 'success';
  return 'pending';
}

export function formatDuration(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || ms <= 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

export const STATUS_DOT_CLASS: Record<StepOverlayStatus, string> = {
  pending: 'bg-slate-400',
  running: 'bg-blue-500 animate-pulse',
  success: 'bg-emerald-500',
  error: 'bg-red-500',
  skipped: 'bg-slate-300',
};

export const STATUS_LABEL: Record<StepOverlayStatus, string> = {
  pending: '待执行',
  running: '运行中',
  success: '成功',
  error: '失败',
  skipped: '跳过',
};
