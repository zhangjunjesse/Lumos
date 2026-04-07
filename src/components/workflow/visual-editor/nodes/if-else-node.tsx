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

function IfElseNodeInner({ data, selected }: NodeProps & { data: StepNodeData }) {
  const cond = fmtCond(data.input?.condition);

  if (data.isContainer) {
    return (
      <div className={[
        'rounded-xl border w-full h-full',
        selected ? 'border-amber-500 ring-2 ring-amber-500/20' : 'border-amber-500/40',
        'bg-amber-500/[0.04]',
      ].join(' ')}>
        <Handle type="target" position={Position.Left} style={{ top: HEADER_H / 2 }} className="!w-2 !h-2 !bg-amber-500" />
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm bg-amber-500 shrink-0 rotate-45" />
            <span className="text-[11px] font-semibold text-foreground flex-1">IF / ELSE</span>
          </div>
          {cond && <div className="text-[9px] text-muted-foreground mt-0.5 truncate">if {cond}</div>}
        </div>
        <div className="border-t border-amber-500/20 mx-2" />
        <Handle type="source" position={Position.Right} style={{ top: HEADER_H / 2 }} className="!w-2 !h-2 !bg-amber-500" />
      </div>
    );
  }

  const thenIds = Array.isArray(data.input?.then) ? (data.input.then as string[]) : [];
  const elseIds = Array.isArray(data.input?.else) ? (data.input.else as string[]) : [];
  return (
    <div className={[
      'rounded-lg border bg-background px-2.5 py-2 shadow-sm transition-all w-[180px]',
      selected ? 'border-primary ring-2 ring-primary/20' : 'border-amber-500/40',
    ].join(' ')}>
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-amber-500" />
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-sm bg-amber-500 shrink-0 rotate-45" />
        <span className="text-[11px] font-semibold text-foreground flex-1">IF / ELSE</span>
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
