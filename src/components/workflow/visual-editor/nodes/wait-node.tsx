'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';

function formatDuration(ms: unknown): string {
  if (typeof ms !== 'number' || ms <= 0) return '?';
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

function WaitNodeInner({ data, selected }: NodeProps & { data: StepNodeData }) {
  const duration = formatDuration(data.input?.durationMs);

  return (
    <div
      className={[
        'rounded-lg border bg-background px-2.5 py-2 shadow-sm transition-all w-[140px]',
        selected ? 'border-primary ring-2 ring-primary/20' : 'border-border/60',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-orange-400" />
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-orange-400 shrink-0" />
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">等待</span>
        <span className="text-[9px] text-muted-foreground shrink-0">{duration}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-orange-400" />
    </div>
  );
}

export const WaitNode = memo(WaitNodeInner);
