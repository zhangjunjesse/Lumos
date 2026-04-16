'use client';

import {
  STATUS_DOT_CLASS,
  STATUS_LABEL,
  aggregateStatus,
  formatDuration,
  type StepAggregateOverlay,
  type WorkflowDslStepOverlay,
} from '@/lib/workflow/step-overlay';
import type { NodeDebugInfo } from '../node-overlay-context';

export function DebugBadge({ debug }: { debug: NodeDebugInfo | null }) {
  if (!debug) return null;
  const { meta, running } = debug;
  if (running) {
    return (
      <span
        title="调试运行中"
        className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-blue-500 ring-2 ring-background animate-pulse"
      />
    );
  }
  if (!meta) {
    return (
      <span
        title="无缓存"
        className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-muted-foreground/40 ring-2 ring-background"
      />
    );
  }
  if (meta.status === 'error') {
    return (
      <span
        title={`失败缓存 · ${formatDuration(meta.durationMs) || ''}`}
        className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500 ring-2 ring-background"
      />
    );
  }
  const stale = meta.stale;
  const color = stale ? 'bg-amber-500' : 'bg-emerald-500';
  const tooltip = `${stale ? '缓存陈旧(配置已改) · ' : '已缓存 · '}${formatDuration(meta.durationMs) || ''} · ${meta.completedAt}`;
  return (
    <span
      title={tooltip}
      className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ${color} ring-2 ring-background`}
    />
  );
}

export function StatusDot({ overlay }: { overlay: WorkflowDslStepOverlay | undefined }) {
  if (!overlay) return null;
  return (
    <span
      title={STATUS_LABEL[overlay.status]}
      className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT_CLASS[overlay.status]}`}
    />
  );
}

export function RunDurationLabel({ overlay }: { overlay: WorkflowDslStepOverlay | undefined }) {
  const d = formatDuration(overlay?.durationMs);
  if (!d) return null;
  return <span className="text-[8px] text-muted-foreground shrink-0 font-mono">{d}</span>;
}

export function OverlayFooter({ overlay }: { overlay: WorkflowDslStepOverlay | undefined }) {
  if (!overlay) return null;
  const err = overlay.status === 'error';
  return (
    <div
      className={[
        'absolute left-0 right-0 -bottom-5 px-2 h-[18px] rounded-md border text-[9px] flex items-center gap-1 shadow-sm',
        err
          ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
          : 'border-border/40 bg-background/95 text-muted-foreground',
      ].join(' ')}
      title={overlay.error || overlay.outputSummary || undefined}
    >
      {overlay.outputFileCount > 0 && <span className="shrink-0">📄 {overlay.outputFileCount}</span>}
      <span className="truncate flex-1">
        {overlay.error || overlay.outputSummary || STATUS_LABEL[overlay.status]}
      </span>
    </div>
  );
}

export function AggregateBadge({ agg }: { agg: StepAggregateOverlay | undefined }) {
  if (!agg) return null;
  const status = aggregateStatus(agg);
  const done = agg.success + agg.skipped;
  return (
    <span
      title={`完成 ${done}/${agg.total}${agg.error ? ` · 失败 ${agg.error}` : ''}${agg.running ? ` · 运行 ${agg.running}` : ''}`}
      className={[
        'text-[9px] font-mono px-1 py-0 rounded shrink-0 flex items-center gap-0.5',
        status === 'error' ? 'bg-red-500/15 text-red-600 dark:text-red-300' : '',
        status === 'running' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-300' : '',
        status === 'success' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : '',
        status === 'pending' ? 'bg-slate-500/10 text-muted-foreground' : '',
      ].join(' ')}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT_CLASS[status]}`} />
      {done}/{agg.total}
    </span>
  );
}
