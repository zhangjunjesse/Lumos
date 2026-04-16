'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';
import { CONT_HEADER_H } from '@/lib/workflow/dsl-graph-layout';
import { useNodeAggregate, useNodeOverlay } from '../node-overlay-context';
import { AggregateBadge, OverlayFooter, StatusDot } from './overlay-parts';

function ForEachNodeInner({ data, selected }: NodeProps & { data: StepNodeData }) {
  const overlay = useNodeOverlay(data.stepId);
  const aggregate = useNodeAggregate(data.stepId);
  const collection = typeof data.input?.collection === 'string' ? data.input.collection : '?';

  if (data.isContainer) {
    return (
      <div className={[
        'relative rounded-xl border w-full h-full bg-emerald-500/[0.04]',
        data.isDropTarget
          ? 'border-2 border-dashed border-emerald-500 ring-2 ring-emerald-500/30'
          : selected ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-emerald-500/40',
      ].join(' ')}>
        <Handle type="target" position={Position.Left} style={{ top: CONT_HEADER_H / 2 }} className="!w-2 !h-2 !bg-emerald-500" />
        <div className="px-3 py-2.5" style={{ height: CONT_HEADER_H }}>
          <div className="flex items-center gap-1.5">
            <StatusDot overlay={overlay} />
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-[11px] font-semibold text-foreground flex-1">FOR EACH</span>
            <AggregateBadge agg={aggregate} />
          </div>
          <div className="text-[9px] text-muted-foreground mt-0.5 truncate">in {collection}</div>
        </div>
        <div className="border-t border-emerald-500/20 mx-2" />
        <Handle type="source" position={Position.Right} style={{ top: CONT_HEADER_H / 2 }} className="!w-2 !h-2 !bg-emerald-500" />
      </div>
    );
  }

  const bodyIds = Array.isArray(data.input?.body) ? (data.input.body as string[]) : [];
  return (
    <div className={[
      'relative rounded-lg border bg-background px-2.5 py-2 shadow-sm transition-all w-[180px]',
      selected ? 'border-primary ring-2 ring-primary/20' : 'border-emerald-500/40',
    ].join(' ')}>
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-emerald-500" />
      <div className="flex items-center gap-1.5">
        <StatusDot overlay={overlay} />
        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
        <span className="text-[11px] font-semibold text-foreground flex-1">FOR EACH</span>
      </div>
      <div className="mt-1 text-[9px] text-muted-foreground truncate">{collection} → [{bodyIds.join(',')}]</div>
      <OverlayFooter overlay={overlay} />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-emerald-500" />
    </div>
  );
}

export const ForEachNode = memo(ForEachNodeInner);
