'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';

const HEADER_H = 46;

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
  const maxIter = typeof data.input?.maxIterations === 'number' ? data.input.maxIterations : 20;
  const cond = fmtCond(data.input?.condition);
  const isDoWhile = data.input?.mode === 'do-while';
  const label = isDoWhile ? 'DO-WHILE' : 'WHILE';

  if (data.isContainer) {
    return (
      <div className={[
        'rounded-xl border w-full h-full',
        selected ? 'border-sky-500 ring-2 ring-sky-500/20' : 'border-sky-500/40',
        'bg-sky-500/[0.04]',
      ].join(' ')}>
        <Handle type="target" position={Position.Left} style={{ top: HEADER_H / 2 }} className="!w-2 !h-2 !bg-sky-500" />
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
            <span className="text-[11px] font-semibold text-foreground flex-1">{label}</span>
            <span className="text-[9px] text-sky-600 dark:text-sky-400 shrink-0">max:{maxIter}</span>
          </div>
          {cond && <div className="text-[9px] text-muted-foreground mt-0.5 truncate">{cond}</div>}
        </div>
        <div className="border-t border-sky-500/20 mx-2" />
        <Handle type="source" position={Position.Right} style={{ top: HEADER_H / 2 }} className="!w-2 !h-2 !bg-sky-500" />
      </div>
    );
  }

  // Compact mode (empty body)
  const bodyIds = Array.isArray(data.input?.body) ? (data.input.body as string[]) : [];
  return (
    <div className={[
      'rounded-lg border bg-background px-2.5 py-2 shadow-sm transition-all w-[180px]',
      selected ? 'border-primary ring-2 ring-primary/20' : 'border-sky-500/40',
    ].join(' ')}>
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-sky-500" />
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
        <span className="text-[11px] font-semibold text-foreground flex-1">{label}</span>
      </div>
      <div className="mt-1 text-[9px] text-muted-foreground truncate">body:[{bodyIds.join(',')}] max:{maxIter}</div>
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-sky-500" />
    </div>
  );
}

export const WhileNode = memo(WhileNodeInner);
