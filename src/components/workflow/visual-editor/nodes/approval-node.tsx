'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';
import { useNodeDebug, useNodeFlash, useNodeOverlay, useNodeValidation } from '../node-overlay-context';
import {
  ContainerBadge, DebugBadge, FailureAccentBar, FlashRing, NodeValidationBadge,
  OverlayFooter, RetryRing, RunDurationLabel, StatusDot,
} from './overlay-parts';

const MODE_LABEL: Record<string, string> = {
  any: '任一',
  all: '全员',
  quorum: '法定',
};

function ApprovalNodeInner({ data, selected }: NodeProps & { data: StepNodeData }) {
  const overlay = useNodeOverlay(data.stepId);
  const debug = useNodeDebug(data.stepId);
  const validation = useNodeValidation(data.stepId);
  const flash = useNodeFlash(data.stepId);
  const input = (data.node.type === 'approval' ? data.node.input : {}) as Record<string, unknown>;
  const prompt = typeof input.prompt === 'string' ? input.prompt : '';
  const approvers = input.approvers as
    | { mode?: string; users?: string[]; quorum?: number }
    | undefined;
  const mode = approvers?.mode ?? 'any';
  const userCount = Array.isArray(approvers?.users) ? approvers.users.length : 0;
  const timeout = input.timeout as { duration?: string } | undefined;
  const isWaiting = overlay?.status === 'running' || overlay?.status === 'pending';

  const border = selected
    ? 'border-primary ring-2 ring-primary/20'
    : isWaiting
      ? 'border-amber-500 ring-2 ring-amber-500/30'
      : 'border-amber-500/40';

  return (
    <div
      className={[
        'relative bg-background px-2.5 py-2 shadow-sm transition-all border',
        'w-[180px]',
        border,
        isWaiting ? 'animate-[pulse_2.5s_ease-in-out_infinite]' : '',
      ].join(' ')}
      style={{ clipPath: 'polygon(10% 0, 90% 0, 100% 50%, 90% 100%, 10% 100%, 0 50%)' }}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-amber-500" />
      <FlashRing active={flash} />
      <FailureAccentBar overlay={overlay} />
      <ContainerBadge containerId={data.containerId} />
      <DebugBadge debug={debug} />
      <NodeValidationBadge validation={validation} />
      <RetryRing overlay={overlay} />
      <div className="flex items-center gap-1.5 px-3">
        <StatusDot overlay={overlay} />
        <span className="shrink-0 text-[10px]" aria-hidden>✋</span>
        <span className="text-[11px] font-semibold text-foreground flex-1 truncate">{data.label || '人工审批'}</span>
        <RunDurationLabel overlay={overlay} />
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-[9px] text-amber-700 dark:text-amber-400 px-3">
        <span>{MODE_LABEL[mode] ?? mode}</span>
        <span className="text-muted-foreground">·</span>
        <span>{userCount} 人</span>
        {timeout?.duration && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono">{timeout.duration}</span>
          </>
        )}
      </div>
      {prompt && (
        <div
          className="mt-1 text-[9px] text-muted-foreground leading-snug line-clamp-1 truncate px-3"
          title={prompt}
        >
          {prompt}
        </div>
      )}
      <OverlayFooter overlay={overlay} />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-amber-500" />
    </div>
  );
}

export const ApprovalNode = memo(ApprovalNodeInner);
