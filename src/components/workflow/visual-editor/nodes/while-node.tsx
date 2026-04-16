'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';
import { CONT_HEADER_H } from '@/lib/workflow/dsl-graph-layout';
import { useNodeAggregate, useNodeDebug, useNodeOverlay } from '../node-overlay-context';
import { AggregateBadge, DebugBadge, OverlayFooter, StatusDot } from './overlay-parts';

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
  const maxIter = typeof data.input?.maxIterations === 'number' ? data.input.maxIterations : 20;
  const cond = fmtCond(data.input?.condition);
  const isDoWhile = data.input?.mode === 'do-while';
  const label = isDoWhile ? 'DO-WHILE' : 'WHILE';

  if (data.isContainer) {
    return (
      <div className={[
        'relative rounded-xl border w-full h-full bg-sky-500/[0.04]',
        data.isDropTarget
          ? 'border-2 border-dashed border-emerald-500 ring-2 ring-emerald-500/30'
          : selected ? 'border-sky-500 ring-2 ring-sky-500/20' : 'border-sky-500/40',
      ].join(' ')}>
        <Handle type="target" position={Position.Left} style={{ top: CONT_HEADER_H / 2 }} className="!w-2 !h-2 !bg-sky-500" />
        <DebugBadge debug={debug} />
        <div className="px-3 py-2.5" style={{ height: CONT_HEADER_H }}>
          <div className="flex items-center gap-1.5">
            <StatusDot overlay={overlay} />
            <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
            <span className="text-[11px] font-semibold text-foreground flex-1">{label}</span>
            <AggregateBadge agg={aggregate} />
            <span className="text-[9px] text-sky-600 dark:text-sky-400 shrink-0">max:{maxIter}</span>
          </div>
          {cond && <div className="text-[9px] text-muted-foreground mt-0.5 truncate">{cond}</div>}
        </div>
        <div className="border-t border-sky-500/20 mx-2" />
        <Handle type="source" position={Position.Right} style={{ top: CONT_HEADER_H / 2 }} className="!w-2 !h-2 !bg-sky-500" />
      </div>
    );
  }

  const bodyIds = Array.isArray(data.input?.body) ? (data.input.body as string[]) : [];
  return (
    <div className={[
      'relative rounded-lg border bg-background px-2.5 py-2 shadow-sm transition-all w-[180px]',
      selected ? 'border-primary ring-2 ring-primary/20' : 'border-sky-500/40',
    ].join(' ')}>
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-sky-500" />
      <div className="flex items-center gap-1.5">
        <StatusDot overlay={overlay} />
        <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
        <span className="text-[11px] font-semibold text-foreground flex-1">{label}</span>
      </div>
      <div className="mt-1 text-[9px] text-muted-foreground truncate">body:[{bodyIds.join(',')}] max:{maxIter}</div>
      <OverlayFooter overlay={overlay} />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-sky-500" />
    </div>
  );
}

export const WhileNode = memo(WhileNodeInner);
