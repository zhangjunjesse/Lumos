'use client';

import Link from 'next/link';

import type { DebugStepOutput } from '@/lib/workflow/debug-types';
import { formatDuration } from '@/lib/workflow/step-overlay';
import { useWorkflowDebugStore } from '@/stores/workflow-debug-store';
import { extractOutput } from './debug-output-extract';
import {
  OUTCOME_CFG,
  Collapsible,
  SummarySection,
  TraceSection,
  ArtifactsSection,
  FieldsSection,
  DiagnosticsSection,
  MemorySection,
} from './debug-output-sections';

interface Props {
  stepId: string;
  workflowId: string | null;
  latestRunId: string | null;
  output: DebugStepOutput | null;
  loading: boolean;
  stale?: boolean;
  onClose: () => void;
  onDelete: () => void;
}

function StatusBadge({ status }: { status: 'success' | 'error' }) {
  const cls = status === 'error'
    ? 'bg-red-500/15 text-red-700 dark:text-red-400'
    : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400';
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cls} shrink-0`}>
      {status === 'error' ? '失败' : '成功'}
    </span>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const cfg = OUTCOME_CFG[outcome];
  if (!cfg) return null;
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.cls} shrink-0`}>
      {cfg.label}
    </span>
  );
}

export function DebugOutputPanel({
  stepId, workflowId, latestRunId,
  output, loading, stale, onClose, onDelete,
}: Props) {
  const extracted = output ? extractOutput(output.output) : null;
  const hasError = output?.status === 'error' || extracted?.outcome === 'failed';
  const roleLabel = [extracted?.roleName ?? extracted?.role, extracted?.agentType]
    .filter(Boolean)
    .join(' · ');
  const runHref = workflowId && latestRunId
    ? `/workflow/schedules/${workflowId}/runs/${latestRunId}`
    : null;

  const traceState = useWorkflowDebugStore((s) => s.traceByStep[stepId]);
  const loadStepTrace = useWorkflowDebugStore((s) => s.loadStepTrace);

  return (
    <div className="absolute right-2 top-2 bottom-2 w-[480px] rounded-lg border border-border/70 bg-background shadow-xl flex flex-col text-[11px] z-20 overflow-hidden">
      {/* Sticky header */}
      <div className="shrink-0 border-b border-border/50 bg-background/95 backdrop-blur">
        <div className="flex items-center gap-2 px-3 py-2">
          <span className="font-semibold text-foreground flex-1 truncate text-xs" title={stepId}>
            {stepId}
          </span>
          {output && <StatusBadge status={output.status} />}
          {extracted?.outcome && <OutcomeBadge outcome={extracted.outcome} />}
          {output && (
            <span className="text-[10px] text-muted-foreground shrink-0">
              {formatDuration(output.durationMs) || '—'}
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-5 h-5 rounded hover:bg-accent text-muted-foreground shrink-0 flex items-center justify-center"
            aria-label="关闭"
          >×</button>
        </div>
        {stale && (
          <div className="px-3 py-1.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px] border-t border-amber-500/20">
            ⚠ 节点配置已修改,缓存可能不再匹配当前配置
          </div>
        )}
      </div>

      {/* Body */}
      {loading && <div className="flex-1 p-4 text-muted-foreground">加载中…</div>}
      {!loading && !output && <div className="flex-1 p-4 text-muted-foreground">无缓存数据</div>}

      {!loading && output && extracted && (
        <div className="flex-1 overflow-auto px-3 py-3 space-y-3">
          {roleLabel && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="opacity-70">执行角色</span>
              <span className="text-foreground font-medium">{roleLabel}</span>
              <span className="ml-auto opacity-60">{output.completedAt}</span>
            </div>
          )}

          {output.error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 text-red-700 dark:text-red-400 whitespace-pre-wrap break-words leading-relaxed">
              {output.error}
            </div>
          )}

          {extracted.summary && <SummarySection markdown={extracted.summary} />}
          {latestRunId && (
            <TraceSection
              loading={!!traceState?.loading}
              content={traceState?.content ?? null}
              hasTrace={!!traceState?.hasTrace}
              error={traceState?.error ?? null}
              onFirstOpen={() => { void loadStepTrace(stepId); }}
            />
          )}
          <ArtifactsSection items={extracted.artifacts} />
          <FieldsSection fields={extracted.businessFields} />
          {extracted.diagnostics && (
            <DiagnosticsSection d={extracted.diagnostics} hasError={!!hasError} />
          )}
          <MemorySection items={extracted.memoryAppend} />

          {extracted.metrics && Object.keys(extracted.metrics).length > 0 && (
            <Collapsible title="指标">
              <pre className="text-[10px] font-mono whitespace-pre-wrap break-all bg-muted/30 rounded p-2">
                {JSON.stringify(extracted.metrics, null, 2)}
              </pre>
            </Collapsible>
          )}

          {Object.keys(output.metadata ?? {}).length > 0 && (
            <Collapsible title="元数据">
              <pre className="text-[10px] font-mono whitespace-pre-wrap break-all bg-muted/30 rounded p-2">
                {JSON.stringify(output.metadata, null, 2)}
              </pre>
            </Collapsible>
          )}
        </div>
      )}

      {/* Footer */}
      {!loading && output && (
        <div className="shrink-0 border-t border-border/50 px-3 py-2 flex items-center gap-2 bg-muted/20">
          <button
            type="button"
            onClick={onDelete}
            className="text-[10px] text-red-600 dark:text-red-400 hover:underline"
          >
            删除缓存
          </button>
          <span className="text-[9px] text-muted-foreground font-mono truncate flex-1" title={output.configHash}>
            {output.configHash.slice(0, 12)}…
          </span>
          {runHref && (
            <Link
              href={runHref}
              target="_blank"
              className="text-[10px] text-primary hover:underline shrink-0 font-medium"
              title="在新标签打开完整执行记录"
            >
              完整执行记录 →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
