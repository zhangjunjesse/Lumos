'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';
import { useNodeDebug, useNodeFlash, useNodeOverlay, useNodeValidation } from '../node-overlay-context';
import {
  ContainerBadge, DebugBadge, FailureAccentBar, FlashRing, NodeValidationBadge,
  OverlayFooter, RetryRing, RunDurationLabel, StatusDot,
} from './overlay-parts';

function formatDuration(ms: unknown): string {
  if (typeof ms !== 'number' || ms <= 0) return '?';
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

function WaitNodeInner({ data, selected }: NodeProps & { data: StepNodeData }) {
  const overlay = useNodeOverlay(data.stepId);
  const debug = useNodeDebug(data.stepId);
  const validation = useNodeValidation(data.stepId);
  const flash = useNodeFlash(data.stepId);
  const input = (data.node.type === 'wait' ? data.node.input : {}) as Record<string, unknown>;
  const duration = formatDuration(input.durationMs);

  return (
    <div
      className={[
        'relative rounded-lg border bg-background px-2.5 py-2 shadow-sm transition-all w-[140px]',
        selected ? 'border-primary ring-2 ring-primary/20' : 'border-border/60',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-orange-400" />
      <FlashRing active={flash} />
      <FailureAccentBar overlay={overlay} />
      <ContainerBadge containerId={data.containerId} />
      <DebugBadge debug={debug} />
      <NodeValidationBadge validation={validation} />
      <RetryRing overlay={overlay} />
      <div className="flex items-center gap-1.5">
        <StatusDot overlay={overlay} />
        <span className="inline-block w-2 h-2 rounded-full bg-orange-400 shrink-0" />
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">等待</span>
        {overlay ? <RunDurationLabel overlay={overlay} /> : (
          <span className="text-[9px] text-muted-foreground shrink-0">{duration}</span>
        )}
      </div>
      <OverlayFooter overlay={overlay} />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-orange-400" />
    </div>
  );
}

export const WaitNode = memo(WaitNodeInner);
