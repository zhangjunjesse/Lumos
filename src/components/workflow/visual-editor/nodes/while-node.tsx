'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';

function formatTimeoutLabel(ms: number | undefined): string | null {
  if (typeof ms !== 'number' || ms <= 0) return null;
  const min = ms / 60_000;
  return min >= 1 ? `${Math.round(min)}m` : `${Math.round(ms / 1000)}s`;
}

function WhileNodeInner({ data, selected }: NodeProps & { data: StepNodeData }) {
  const bodyIds = Array.isArray(data.input?.body) ? (data.input.body as string[]) : [];
  const maxIter = typeof data.input?.maxIterations === 'number' ? data.input.maxIterations : 20;
  const timeoutLabel = formatTimeoutLabel(data.policy?.timeoutMs);

  return (
    <div
      className={[
        'rounded-lg border bg-background px-2.5 py-2 shadow-sm transition-all w-[180px]',
        selected ? 'border-primary ring-2 ring-primary/20' : 'border-sky-500/40',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-sky-500" />
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-sky-500 shrink-0" />
        <span className="text-[11px] font-semibold text-foreground flex-1">WHILE</span>
        {timeoutLabel && <span className="text-[8px] text-muted-foreground shrink-0">{timeoutLabel}</span>}
      </div>
      <div className="mt-1 text-[9px] text-muted-foreground truncate">body:[{bodyIds.join(',')}] max:{maxIter}</div>
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-sky-500" />
    </div>
  );
}

export const WhileNode = memo(WhileNodeInner);
