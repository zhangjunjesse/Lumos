'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';
import {
  useNodeAggregate,
  useNodeDebug,
  useNodeFlash,
  useNodeGroupHighlight,
  useNodeOverlay,
  useNodeValidation,
} from '../node-overlay-context';
import {
  AggregateBadge, ContainerBadge, DebugBadge, FailureAccentBar, FlashRing,
  NodeValidationBadge, OverlayFooter, StatusDot,
} from './overlay-parts';

const FAIL_LABEL: Record<string, string> = {
  'fail-fast': '快速失败',
  'wait-all': '全部等待',
  'best-effort': '尽力而为',
};

function ParallelNodeInner({ data, selected }: NodeProps & { data: StepNodeData }) {
  const overlay = useNodeOverlay(data.stepId);
  const aggregate = useNodeAggregate(data.stepId);
  const debug = useNodeDebug(data.stepId);
  const groupHit = useNodeGroupHighlight(data.stepId);
  const validation = useNodeValidation(data.stepId);
  const flash = useNodeFlash(data.stepId);
  const input = (data.node.type === 'parallel' ? data.node.input : {}) as Record<string, unknown>;
  const onBranchFail = typeof input.onBranchFail === 'string' ? input.onBranchFail : 'wait-all';
  const branchCount = data.branchCount ?? 0;

  const border = selected
    ? 'border-primary ring-2 ring-primary/20'
    : groupHit
      ? 'border-sky-500 ring-2 ring-sky-500/30'
      : 'border-sky-500/40';

  return (
    <div
      className={[
        'relative bg-background px-2.5 py-2 shadow-sm transition-all border',
        'w-[180px]',
        border,
      ].join(' ')}
      style={{ clipPath: 'polygon(0 0, 100% 0, 88% 100%, 12% 100%)' }}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-sky-500" />
      <FlashRing active={flash} />
      <FailureAccentBar overlay={overlay} />
      <ContainerBadge containerId={data.containerId} />
      <DebugBadge debug={debug} />
      <NodeValidationBadge validation={validation} />
      <div className="flex items-center gap-1.5 px-2">
        <StatusDot overlay={overlay} />
        <svg width="10" height="10" viewBox="0 0 10 10" className="shrink-0">
          <path d="M1 1 L5 5 L9 1" fill="none" stroke="#0ea5e9" strokeWidth="1.4" />
          <path d="M1 9 L5 5 L9 9" fill="none" stroke="#0ea5e9" strokeWidth="1.4" />
        </svg>
        <span className="text-[11px] font-semibold text-foreground flex-1">PARALLEL</span>
        <AggregateBadge agg={aggregate} />
      </div>
      <div className="mt-0.5 text-[9px] text-muted-foreground truncate px-2" title={FAIL_LABEL[onBranchFail] ?? onBranchFail}>
        {FAIL_LABEL[onBranchFail] ?? onBranchFail}
      </div>
      {branchCount > 0 && (
        <div className="mt-1 text-[9px] text-sky-600 dark:text-sky-400 px-2">
          分支 · {branchCount}
        </div>
      )}
      <OverlayFooter overlay={overlay} />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-sky-500" />
    </div>
  );
}

export const ParallelNode = memo(ParallelNodeInner);
