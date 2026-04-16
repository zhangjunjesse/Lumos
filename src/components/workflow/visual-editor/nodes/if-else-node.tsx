'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StepNodeData } from '@/lib/workflow/dsl-graph-converter';
import {
  BRANCH_GAP,
  BRANCH_LABEL_H,
  CONT_HEADER_H,
  CONT_PAD_BOTTOM,
} from '@/lib/workflow/dsl-graph-layout';
import { useNodeAggregate, useNodeOverlay } from '../node-overlay-context';
import { AggregateBadge, OverlayFooter, StatusDot } from './overlay-parts';

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

// THEN = 主路径（和容器同色，更亮）；ELSE = 备选路径（灰，更暗）
const BRANCH_STYLES = {
  then: {
    zone: 'bg-amber-500/[0.04]',
    bar: 'bg-amber-500/60',
    label: 'text-amber-700 dark:text-amber-400',
  },
  else: {
    zone: 'bg-foreground/[0.03]',
    bar: 'bg-foreground/25',
    label: 'text-muted-foreground',
  },
} as const;

function BranchZone({
  top, height, branch, label,
}: {
  top: number; height: number | string; branch: 'then' | 'else'; label: 'THEN' | 'ELSE';
}) {
  const s = BRANCH_STYLES[branch];
  return (
    <>
      <div
        className={`absolute left-2 right-2 rounded-md pointer-events-none ${s.zone}`}
        style={{ top, height }}
      />
      <div
        className={`absolute left-2 w-[3px] rounded-full pointer-events-none ${s.bar}`}
        style={{ top, height }}
      />
      <div
        className={`absolute left-4 text-[9px] font-semibold tracking-[0.15em] ${s.label}`}
        style={{ top, height: BRANCH_LABEL_H, lineHeight: `${BRANCH_LABEL_H}px` }}
      >
        {label}
      </div>
    </>
  );
}

function IfElseNodeInner({ data, selected }: NodeProps & { data: StepNodeData }) {
  const overlay = useNodeOverlay(data.stepId);
  const aggregate = useNodeAggregate(data.stepId);
  const cond = fmtCond(data.input?.condition);

  if (data.isContainer) {
    const thenH = data.thenBlockH ?? 0;
    const thenZoneTop = CONT_HEADER_H;
    const thenZoneH = BRANCH_LABEL_H + thenH;
    const elseZoneTop = thenZoneTop + thenZoneH + BRANCH_GAP;
    // ELSE 区域向下延伸到容器底部 padding 上沿
    const elseZoneH = `calc(100% - ${elseZoneTop + CONT_PAD_BOTTOM}px)`;

    return (
      <div className={[
        'relative rounded-xl border w-full h-full bg-amber-500/[0.03]',
        data.isDropTarget
          ? 'border-2 border-dashed border-emerald-500 ring-2 ring-emerald-500/30'
          : selected ? 'border-amber-500 ring-2 ring-amber-500/20' : 'border-amber-500/40',
      ].join(' ')}>
        <Handle type="target" position={Position.Left} style={{ top: CONT_HEADER_H / 2 }} className="!w-2 !h-2 !bg-amber-500" />
        <div className="px-3 py-2.5" style={{ height: CONT_HEADER_H }}>
          <div className="flex items-center gap-1.5">
            <StatusDot overlay={overlay} />
            <span className="w-2 h-2 rounded-sm bg-amber-500 shrink-0 rotate-45" />
            <span className="text-[11px] font-semibold text-foreground flex-1">IF / ELSE</span>
            <AggregateBadge agg={aggregate} />
          </div>
          {cond && <div className="text-[9px] text-muted-foreground mt-0.5 truncate">if {cond}</div>}
        </div>
        <div className="border-t border-amber-500/30 mx-2" />
        <BranchZone top={thenZoneTop} height={thenZoneH} branch="then" label="THEN" />
        <BranchZone top={elseZoneTop} height={elseZoneH} branch="else" label="ELSE" />
        <Handle type="source" position={Position.Right} style={{ top: CONT_HEADER_H / 2 }} className="!w-2 !h-2 !bg-amber-500" />
      </div>
    );
  }

  const thenIds = Array.isArray(data.input?.then) ? (data.input.then as string[]) : [];
  const elseIds = Array.isArray(data.input?.else) ? (data.input.else as string[]) : [];
  return (
    <div className={[
      'relative rounded-lg border bg-background px-2.5 py-2 shadow-sm transition-all w-[180px]',
      selected ? 'border-primary ring-2 ring-primary/20' : 'border-amber-500/40',
    ].join(' ')}>
      <Handle type="target" position={Position.Left} className="!w-2 !h-2 !bg-amber-500" />
      <div className="flex items-center gap-1.5">
        <StatusDot overlay={overlay} />
        <span className="w-2 h-2 rounded-sm bg-amber-500 shrink-0 rotate-45" />
        <span className="text-[11px] font-semibold text-foreground flex-1">IF / ELSE</span>
      </div>
      <div className="mt-1 flex gap-1.5 text-[9px] text-muted-foreground truncate">
        <span className="text-emerald-600 dark:text-emerald-400">T:[{thenIds.join(',')}]</span>
        {elseIds.length > 0 && <span className="text-red-500 dark:text-red-400">E:[{elseIds.join(',')}]</span>}
      </div>
      <OverlayFooter overlay={overlay} />
      <Handle type="source" position={Position.Right} className="!w-2 !h-2 !bg-amber-500" />
    </div>
  );
}

export const IfElseNode = memo(IfElseNodeInner);
