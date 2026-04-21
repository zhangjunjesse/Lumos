'use client';

import { useMemo } from 'react';
import type { WorkflowDslStepOverlay } from './WorkflowDslGraph';
import type { WorkflowNode } from '@/lib/workflow/types-v3';
import {
  SURFACED_INPUT_KEYS,
  getString,
  readInput,
} from './step-detail/step-detail-helpers';
import {
  StepDetailHeader,
  StepInputSnapshotSection,
  StepOutputFiles,
  StepOutputSummary,
  StepRunError,
  StepRunMetrics,
  type OutputFileLike,
} from './step-detail/step-detail-run';
import { StepTraceStreamSection } from './step-detail/step-trace-stream-view';
import type { StepTraceEvent } from '@/lib/workflow/step-trace-stream';
import {
  AgentConfigSection,
  ControlFlowSection,
  ForEachSection,
  OtherInputSection,
  PolicySection,
  WaitSection,
} from './step-detail/step-detail-config';

interface Props {
  node: WorkflowNode;
  presetNames: Record<string, string>;
  overlay?: WorkflowDslStepOverlay;
  outputFiles: OutputFileLike[];
  /** Raw snapshot captured at step start — resolved input / runtime / agent / payload. */
  inputSnapshot?: unknown;
  /** Live trace events streamed from the agent while the step is running. */
  liveTrace?: StepTraceEvent[];
  onClose: () => void;
}

export function WorkflowStepDetailPanel({
  node, presetNames, overlay, outputFiles, inputSnapshot, liveTrace, onClose,
}: Props) {
  const fileList = useMemo(
    () => outputFiles.filter((f) => f.stepId === node.id),
    [outputFiles, node.id],
  );

  const input = readInput(node);
  const presetId = getString(input, 'preset');
  const presetLabel = presetId ? presetNames[presetId] || presetId : null;
  const prompt = getString(input, 'prompt');
  const expectedOutput = getString(input, 'expectedOutput');
  const preferredModel = getString(input, 'model');
  const role = getString(input, 'role');

  const otherInput = Object.fromEntries(
    Object.entries(input).filter(
      ([k, v]) => !SURFACED_INPUT_KEYS.has(k) && v !== undefined && v !== null && v !== '',
    ),
  );

  const waitMs = node.type === 'wait' ? node.input.durationMs : null;
  const forEachCollection = node.type === 'for-each' ? node.input.collection : null;
  const isControlFlow = node.type === 'if-else' || node.type === 'while';
  const policy = node.policy;
  const title = presetLabel || node.metadata?.label || node.id;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-5 space-y-4">
      <StepDetailHeader node={node} title={title} overlay={overlay} onClose={onClose} />

      {overlay && <StepRunMetrics overlay={overlay} timeoutMs={policy?.timeoutMs} />}
      {overlay?.error && <StepRunError error={overlay.error} />}
      {overlay?.outputSummary && !overlay.error && <StepOutputSummary summary={overlay.outputSummary} />}

      <StepTraceStreamSection
        events={liveTrace}
        isRunning={overlay?.status === 'running'}
      />

      <StepInputSnapshotSection snapshot={inputSnapshot} />

      <StepOutputFiles files={fileList} />

      {node.type === 'agent' && (
        <AgentConfigSection
          presetLabel={presetLabel}
          preferredModel={preferredModel}
          role={role}
          prompt={prompt}
          expectedOutput={expectedOutput}
        />
      )}

      {isControlFlow && <ControlFlowSection node={node} condition={input.condition} />}
      {node.type === 'for-each' && <ForEachSection collection={forEachCollection} />}
      {node.type === 'wait' && typeof waitMs === 'number' && <WaitSection durationMs={waitMs} />}

      <OtherInputSection other={otherInput} />
      <PolicySection policy={policy} />
    </div>
  );
}
