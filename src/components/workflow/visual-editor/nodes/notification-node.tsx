'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';
import { useNodeDebug, useNodeFlash, useNodeOverlay, useNodeValidation } from '../node-overlay-context';
import {
  ContainerBadge, DebugBadge, FailureAccentBar, FlashRing, NodeValidationBadge,
  OverlayFooter, RetryRing, RunDurationLabel, StatusDot,
} from './overlay-parts';

function NotificationNodeInner({ data, selected }: NodeProps & { data: StepNodeData }) {
  const overlay = useNodeOverlay(data.stepId);
  const debug = useNodeDebug(data.stepId);
  const validation = useNodeValidation(data.stepId);
  const flash = useNodeFlash(data.stepId);
  const input = (data.node.type === 'notification' ? data.node.input : {}) as Record<string, unknown>;
  const message = typeof input.message === 'string' ? input.message : '';

  return (
    <div
      className={[
        'relative rounded-lg border bg-background px-2.5 py-2 shadow-sm transition-all w-[180px]',
        selected ? 'border-primary ring-2 ring-primary/20' : 'border-border/60',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-blue-500" />
      <FlashRing active={flash} />
      <FailureAccentBar overlay={overlay} />
      <ContainerBadge containerId={data.containerId} />
      <DebugBadge debug={debug} />
      <NodeValidationBadge validation={validation} />
      <RetryRing overlay={overlay} />
      <div className="flex items-center gap-1.5">
        <StatusDot overlay={overlay} />
        <span className="inline-block w-2 h-2 rounded-full bg-blue-500 shrink-0" />
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">通知</span>
        <RunDurationLabel overlay={overlay} />
      </div>
      {message && (
        <div className="mt-1 text-[9px] text-muted-foreground leading-snug line-clamp-1 truncate">{message}</div>
      )}
      <OverlayFooter overlay={overlay} />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-blue-500" />
    </div>
  );
}

export const NotificationNode = memo(NotificationNodeInner);
