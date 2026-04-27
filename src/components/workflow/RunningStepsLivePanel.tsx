'use client';

import { StepTraceStreamSection } from './step-detail/step-trace-stream-view';
import type { WorkflowDSLV3 } from '@/lib/workflow/types-v3';
import type { WorkflowDslStepOverlay } from './WorkflowDslGraph';
import type { StepTraceEvent } from '@/lib/workflow/step-trace-stream';

/**
 * Overview panel shown on the "执行过程" tab while the run is still active.
 * For every step that is currently running, renders its live trace stream
 * inside a highlighted card so the user can watch the agent work without
 * having to click into the step detail panel.
 */
export function RunningStepsLivePanel({
  stepLiveTraces,
  stepOverlays,
  workflowDsl,
}: {
  stepLiveTraces: Record<string, StepTraceEvent[]>;
  stepOverlays: Record<string, WorkflowDslStepOverlay>;
  workflowDsl: WorkflowDSLV3 | null;
}) {
  const runningStepIds = Object.entries(stepOverlays)
    .filter(([, overlay]) => overlay.status === 'running')
    .map(([stepId]) => stepId);
  const traceOnlyStepIds = Object.keys(stepLiveTraces).filter(
    (stepId) => !runningStepIds.includes(stepId)
      && (stepOverlays[stepId]?.status ?? 'running') === 'running',
  );
  const entries = [...runningStepIds, ...traceOnlyStepIds].map((stepId) => [
    stepId,
    stepLiveTraces[stepId] ?? [],
  ] as const);
  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground rounded-xl border border-dashed border-border/50 mb-4">
        <div className="inline-block w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-2" />
        <div>正在同步执行状态...</div>
      </div>
    );
  }
  return (
    <div className="space-y-3 mb-4">
      {entries.map(([stepId, events]) => {
        const stepNode = workflowDsl?.nodes.find((n) => n.id === stepId);
        const stepLabel = stepNode?.metadata?.label || stepId;
        const emptyMessage = stepNode?.type === 'wait'
          ? '当前是等待步骤，正在等待下一次重试或后续步骤触发...'
          : stepNode?.type === 'agent'
            ? 'agent 会话正在启动，等待第一条输出...'
            : `${stepLabel} 正在执行，等待运行日志写入...`;
        return (
          <div key={stepId} className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span className="text-xs font-medium">正在运行: {stepLabel}</span>
              <span className="text-[10px] text-muted-foreground font-mono">{stepId}</span>
            </div>
            <StepTraceStreamSection events={events} isRunning title="实时输出" emptyMessage={emptyMessage} />
          </div>
        );
      })}
    </div>
  );
}
