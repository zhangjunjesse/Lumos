'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';
import { useNodeOverlay } from '../node-overlay-context';
import { OverlayFooter, RunDurationLabel, StatusDot } from './overlay-parts';

function formatTimeoutLabel(ms: number | undefined): string | null {
  if (typeof ms !== 'number' || ms <= 0) return null;
  const min = ms / 60_000;
  return min >= 1 ? `${Math.round(min)}m` : `${Math.round(ms / 1000)}s`;
}

function AgentNodeInner({ data, selected }: NodeProps & { data: StepNodeData }) {
  const overlay = useNodeOverlay(data.stepId);
  const prompt = typeof data.input?.prompt === 'string' ? data.input.prompt : '';
  const timeoutLabel = formatTimeoutLabel(data.policy?.timeoutMs);
  const codeConfig = data.input?.code as { script?: string; handler?: string; strategy?: string } | undefined;
  const hasCode = Boolean(codeConfig?.script || codeConfig?.handler);

  return (
    <div
      className={[
        'relative rounded-lg border bg-background px-2.5 py-2 shadow-sm transition-all w-[180px]',
        selected ? 'border-primary ring-2 ring-primary/20' : 'border-border/60',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-violet-500" />
      <div className="flex items-center gap-1.5">
        <StatusDot overlay={overlay} />
        <span className="inline-block w-2 h-2 rounded-full bg-violet-500 shrink-0" />
        <span className="text-[11px] font-semibold text-foreground truncate flex-1">{data.label}</span>
        {hasCode && (
          <span className="text-[8px] bg-emerald-500/15 text-emerald-600 px-1 rounded shrink-0">
            {codeConfig?.strategy === 'code-only' ? 'code' : 'code+'}
          </span>
        )}
        {overlay ? <RunDurationLabel overlay={overlay} /> : timeoutLabel && (
          <span className="text-[8px] text-muted-foreground shrink-0">{timeoutLabel}</span>
        )}
      </div>
      {prompt && (
        <div className="mt-1 text-[9px] text-muted-foreground leading-snug line-clamp-1 truncate">{prompt}</div>
      )}
      <OverlayFooter overlay={overlay} />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-violet-500" />
    </div>
  );
}

export const AgentNode = memo(AgentNodeInner);
