'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';

function CapabilityNodeInner({ data, selected }: NodeProps & { data: StepNodeData }) {
  const capabilityId = typeof data.input?.capabilityId === 'string' ? data.input.capabilityId : '';

  return (
    <div
      className={[
        'rounded-lg border bg-background px-2.5 py-2 shadow-sm transition-all w-[180px]',
        selected ? 'border-primary ring-2 ring-primary/20' : 'border-border/60',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-teal-500" />
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-teal-500 shrink-0" />
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">
          {capabilityId || '能力'}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-teal-500" />
    </div>
  );
}

export const CapabilityNode = memo(CapabilityNodeInner);
