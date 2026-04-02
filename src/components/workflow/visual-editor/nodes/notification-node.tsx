'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';

function NotificationNodeInner({ data, selected }: NodeProps & { data: StepNodeData }) {
  const message = typeof data.input?.message === 'string' ? data.input.message : '';

  return (
    <div
      className={[
        'rounded-lg border bg-background px-2.5 py-2 shadow-sm transition-all w-[180px]',
        selected ? 'border-primary ring-2 ring-primary/20' : 'border-border/60',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-blue-500" />
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-2 h-2 rounded-full bg-blue-500 shrink-0" />
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">通知</span>
      </div>
      {message && (
        <div className="mt-1 text-[9px] text-muted-foreground leading-snug line-clamp-1 truncate">{message}</div>
      )}
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-blue-500" />
    </div>
  );
}

export const NotificationNode = memo(NotificationNodeInner);
