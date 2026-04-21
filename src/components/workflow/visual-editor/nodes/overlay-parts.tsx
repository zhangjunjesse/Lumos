'use client';

import {
  STATUS_DOT_CLASS,
  STATUS_LABEL,
  aggregateStatus,
  formatDuration,
  type StepAggregateOverlay,
  type WorkflowDslStepOverlay,
} from '@/lib/workflow/step-overlay';
import type { NodeDebugInfo, NodeValidationInfo } from '../node-overlay-context';

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

/**
 * 琥珀色旋转环 + "N/M" — 只在步骤正在重试时可见 (attempt > 1, maxAttempts > 1)。
 * 位置:右上角 -top-2 -right-2 的圆角胶囊,比 ValidationBadge 更偏里;
 * 通过 z-index 不与 DebugBadge 重叠,因为两者互斥(调试运行 vs 正式运行)。
 */
export function RetryRing({ overlay }: { overlay: WorkflowDslStepOverlay | undefined }) {
  if (!overlay) return null;
  const attempt = overlay.attempt;
  const maxAttempts = overlay.maxAttempts;
  if (typeof attempt !== 'number' || typeof maxAttempts !== 'number') return null;
  if (maxAttempts <= 1 || attempt <= 1) return null;
  const tooltip = `重试中 · 第 ${attempt}/${maxAttempts} 次尝试`;
  return (
    <span
      title={tooltip}
      className="absolute -top-2 -right-2 flex items-center gap-0.5 h-[16px] px-1 rounded-full border-2 border-background bg-amber-500/90 text-amber-50 shadow"
    >
      <span
        aria-hidden
        className="w-2.5 h-2.5 rounded-full border-2 border-amber-100/40 border-t-amber-50 animate-spin"
      />
      <span className="text-[9px] font-bold leading-none tabular-nums">
        {attempt}/{maxAttempts}
      </span>
    </span>
  );
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

/**
 * 节点属于哪个控制流容器的小徽章 (顶部外挂)。只在 `containerId` 存在时渲染。
 * 作用:拍平布局下一眼看清嵌套关系,不再需要大区域包裹。
 */
export function ContainerBadge({ containerId }: { containerId: string | undefined }) {
  if (!containerId) return null;
  return (
    <div
      title={`属于 ${containerId}`}
      className="absolute -top-2.5 left-2 px-1.5 h-[14px] rounded-sm border border-border/60 bg-background/95 text-[8px] font-mono text-muted-foreground shadow-sm leading-[14px] max-w-[160px] truncate"
    >
      ↳ {containerId}
    </div>
  );
}

/**
 * 校验徽章 — 右上角小圆角胶囊,显示 error / warning 总数。
 * - 有 error: 红色 "!N"
 * - 仅 warning: 黄色 "△N"
 * - 没问题: 不渲染
 *
 * 位置:-top-2 -right-2 (比 DebugBadge 更外圈,不会互相遮挡)。
 */
export function NodeValidationBadge({ validation }: { validation: NodeValidationInfo | null }) {
  if (!validation) return null;
  const errorCount = validation.errors.length;
  const warningCount = validation.warnings.length;
  if (errorCount === 0 && warningCount === 0) return null;
  const isError = errorCount > 0;
  const count = isError ? errorCount : warningCount;
  const tooltip = isError
    ? validation.errors.map((i) => `${i.code}: ${i.message}`).join('\n')
    : validation.warnings.map((i) => `${i.code}: ${i.message}`).join('\n');
  return (
    <span
      title={tooltip}
      className={[
        'absolute -top-2 -right-2 min-w-[16px] h-[16px] px-1 rounded-full border-2 border-background',
        'text-[9px] font-bold leading-[12px] tabular-nums flex items-center justify-center shadow',
        isError
          ? 'bg-red-500 text-white'
          : 'bg-amber-400 text-amber-950',
      ].join(' ')}
    >
      {isError ? '!' : '△'}{count > 9 ? '9+' : count}
    </span>
  );
}

/**
 * 失败时节点左侧 4px 红条,配合 DSL 中的 on-error 路径,快速定位"这步挂了"。
 * 仅当 overlay.status === 'error' 时渲染。
 */
export function FailureAccentBar({ overlay }: { overlay: WorkflowDslStepOverlay | undefined }) {
  if (!overlay || overlay.status !== 'error') return null;
  return (
    <span
      aria-hidden
      className="absolute left-0 top-0 bottom-0 w-1 bg-red-500 rounded-l"
      title="此节点已失败"
    />
  );
}

/** 当节点被 Problem 抽屉定位时的闪烁光圈,包在节点外层。 */
export function FlashRing({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-[-4px] rounded-xl ring-4 ring-red-500/60 animate-ping"
    />
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
