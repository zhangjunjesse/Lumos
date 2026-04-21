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

function JoinNodeInner({ data, selected }: NodeProps & { data: StepNodeData }) {
  const overlay = useNodeOverlay(data.stepId);
  const aggregate = useNodeAggregate(data.stepId);
  const debug = useNodeDebug(data.stepId);
  const groupHit = useNodeGroupHighlight(data.stepId);
  const validation = useNodeValidation(data.stepId);
  const flash = useNodeFlash(data.stepId);
  const inbound = data.inbound ?? 0;

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
      style={{ clipPath: 'polygon(12% 0, 88% 0, 100% 100%, 0 100%)' }}
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
          <path d="M1 1 L5 5 L1 9" fill="none" stroke="#0ea5e9" strokeWidth="1.4" />
          <path d="M9 1 L5 5 L9 9" fill="none" stroke="#0ea5e9" strokeWidth="1.4" />
        </svg>
        <span className="text-[11px] font-semibold text-foreground flex-1">JOIN</span>
        <AggregateBadge agg={aggregate} />
      </div>
      {inbound > 0 && (
        <div className="mt-0.5 text-[9px] text-sky-600 dark:text-sky-400 px-2">
          汇合 · {inbound}
        </div>
      )}
      <OverlayFooter overlay={overlay} />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-sky-500" />
    </div>
  );
}

export const JoinNode = memo(JoinNodeInner);
