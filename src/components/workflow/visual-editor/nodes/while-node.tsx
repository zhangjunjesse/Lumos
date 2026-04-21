'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';
import {
  useNodeAggregate,
  useNodeDebug,
  useNodeFlash,
  useNodeGroupHighlight,
  useNodeOverlay,
  useNodeValidation,
} from '../node-overlay-context';
import {
  AggregateBadge, ContainerBadge, DebugBadge, FailureAccentBar, FlashRing,
  NodeValidationBadge, OverlayFooter, StatusDot,
} from './overlay-parts';

function fmtCond(c: unknown): string {
  if (!c || typeof c !== 'object') return '';
  const o = c as Record<string, unknown>;
  const v = (x: unknown) => String(x).replace(/^steps\.([^.]+)\.output\.?/, '$1.');
  const ops: Record<string, string> = { eq: '==', neq: '!=', gt: '>', lt: '<' };
  if (o.op === 'exists') return `exists(${v(o.ref)})`;
  if (o.op && o.left !== undefined && o.right !== undefined) {
    return `${v(o.left)} ${ops[o.op as string] ?? o.op} ${v(o.right)}`;
  }
  return '';
}

function WhileNodeInner({ data, selected }: NodeProps & { data: StepNodeData }) {
  const overlay = useNodeOverlay(data.stepId);
  const aggregate = useNodeAggregate(data.stepId);
  const debug = useNodeDebug(data.stepId);
  const groupHit = useNodeGroupHighlight(data.stepId);
  const validation = useNodeValidation(data.stepId);
  const flash = useNodeFlash(data.stepId);
  const input = (data.node.type === 'while' ? data.node.input : {}) as Record<string, unknown>;
  const maxIter = typeof input.maxIterations === 'number' ? input.maxIterations : 20;
  const cond = fmtCond(input.condition);
  const isDoWhile = input.mode === 'do-while';
  const label = isDoWhile ? 'DO-WHILE' : 'WHILE';
  const bodyCount = data.bodyCount ?? 0;

  return (
    <div className={[
      'relative rounded-lg border bg-background px-2.5 py-2 shadow-sm transition-all w-[180px]',
      selected
        ? 'border-primary ring-2 ring-primary/20'
        : groupHit
          ? 'border-sky-500 ring-2 ring-sky-500/30'
          : 'border-sky-500/40',
    ].join(' ')}>
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-sky-500" />
      <FlashRing active={flash} />
      <FailureAccentBar overlay={overlay} />
      <ContainerBadge containerId={data.containerId} />
      <DebugBadge debug={debug} />
      <NodeValidationBadge validation={validation} />
      <div className="flex items-center gap-1.5">
        <StatusDot overlay={overlay} />
        <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
        <span className="text-[11px] font-semibold text-foreground flex-1">{label}</span>
        <AggregateBadge agg={aggregate} />
      </div>
      {cond && (
        <div className="mt-0.5 text-[9px] text-muted-foreground truncate" title={cond}>
          {cond}
        </div>
      )}
      <div className="mt-1 flex gap-2 text-[9px]">
        <span className="text-sky-600 dark:text-sky-400">body · {bodyCount}</span>
        <span className="text-muted-foreground">max {maxIter}</span>
      </div>
      <OverlayFooter overlay={overlay} />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-sky-500" />
    </div>
  );
}

export const WhileNode = memo(WhileNodeInner);
