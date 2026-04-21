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

function ForEachNodeInner({ data, selected }: NodeProps & { data: StepNodeData }) {
  const overlay = useNodeOverlay(data.stepId);
  const aggregate = useNodeAggregate(data.stepId);
  const debug = useNodeDebug(data.stepId);
  const groupHit = useNodeGroupHighlight(data.stepId);
  const validation = useNodeValidation(data.stepId);
  const flash = useNodeFlash(data.stepId);
  const input = (data.node.type === 'for-each' ? data.node.input : {}) as Record<string, unknown>;
  const collection = typeof input.collection === 'string' ? input.collection : '?';
  const bodyCount = data.bodyCount ?? 0;

  return (
    <div className={[
      'relative rounded-lg border bg-background px-2.5 py-2 shadow-sm transition-all w-[180px]',
      selected
        ? 'border-primary ring-2 ring-primary/20'
        : groupHit
          ? 'border-emerald-500 ring-2 ring-emerald-500/30'
          : 'border-emerald-500/40',
    ].join(' ')}>
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-emerald-500" />
      <FlashRing active={flash} />
      <FailureAccentBar overlay={overlay} />
      <ContainerBadge containerId={data.containerId} />
      <DebugBadge debug={debug} />
      <NodeValidationBadge validation={validation} />
      <div className="flex items-center gap-1.5">
        <StatusDot overlay={overlay} />
        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
        <span className="text-[11px] font-semibold text-foreground flex-1">FOR EACH</span>
        <AggregateBadge agg={aggregate} />
      </div>
      <div className="mt-0.5 text-[9px] text-muted-foreground truncate" title={collection}>
        in {collection}
      </div>
      <div className="mt-1 text-[9px] text-emerald-600 dark:text-emerald-400">
        body · {bodyCount}
      </div>
      <OverlayFooter overlay={overlay} />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-emerald-500" />
    </div>
  );
}

export const ForEachNode = memo(ForEachNodeInner);
