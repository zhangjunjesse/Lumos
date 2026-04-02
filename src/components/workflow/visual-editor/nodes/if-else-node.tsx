'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';

function formatTimeoutLabel(ms: number | undefined): string | null {
  if (typeof ms !== 'number' || ms <= 0) return null;
  const min = ms / 60_000;
  return min >= 1 ? `${Math.round(min)}m` : `${Math.round(ms / 1000)}s`;
}

function IfElseNodeInner({ data, selected }: NodeProps & { data: StepNodeData }) {
  const thenIds = Array.isArray(data.input?.then) ? (data.input.then as string[]) : [];
  const elseIds = Array.isArray(data.input?.else) ? (data.input.else as string[]) : [];
  const timeoutLabel = formatTimeoutLabel(data.policy?.timeoutMs);

  return (
    <div
      className={[
        'rounded-lg border bg-background px-2.5 py-2 shadow-sm transition-all w-[180px]',
        selected ? 'border-primary ring-2 ring-primary/20' : 'border-amber-500/40',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-amber-500" />
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-sm bg-amber-500 shrink-0 rotate-45" />
        <span className="text-[11px] font-semibold text-foreground flex-1">IF / ELSE</span>
        {timeoutLabel && <span className="text-[8px] text-muted-foreground shrink-0">{timeoutLabel}</span>}
      </div>
      <div className="mt-1 flex gap-1.5 text-[9px] text-muted-foreground truncate">
        <span className="text-emerald-600 dark:text-emerald-400">T:[{thenIds.join(',')}]</span>
        {elseIds.length > 0 && <span className="text-red-500 dark:text-red-400">E:[{elseIds.join(',')}]</span>}
      </div>
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-amber-500" />
    </div>
  );
}

export const IfElseNode = memo(IfElseNodeInner);
