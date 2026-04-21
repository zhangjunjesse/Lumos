import type { Edge } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import type { EdgeKind, WorkflowDSLV3, WorkflowEdge } from './types-v3';

// ── V3 edge renderer ────────────────────────────────────────────────────────
//
// v3 DSL 的 edges 是一等公民, 这里只负责把 dsl.edges 映射成 React Flow Edge 样式:
//
//   next      灰色实线         (顺序/并发分支)
//   then      绿色 "then ✓"
//   else      橙色 "else ✗"
//   body      蓝色 "↻ body"
//   on-error  紫色虚线 "⚠ error"   (异常通道 — 视觉与正常流分离)
//
// 未来若引入 ref 虚线 (来自 `{{ steps.X.output }}` 派生) 可在此添加。

const STYLES: Record<EdgeKind, Record<string, unknown>> = {
  next:       { stroke: '#64748b', strokeWidth: 1.5 },
  then:       { stroke: '#10b981', strokeWidth: 1.6 },
  else:       { stroke: '#f97316', strokeWidth: 1.6 },
  body:       { stroke: '#0ea5e9', strokeWidth: 1.6 },
  'on-error': { stroke: '#a855f7', strokeWidth: 1.5, strokeDasharray: '6 4' },
};

const LABELS: Partial<Record<EdgeKind, string>> = {
  then: 'then ✓',
  else: 'else ✗',
  body: '↻ body',
  'on-error': '⚠ error',
};

export function buildEdgesV3(dsl: WorkflowDSLV3): Edge[] {
  return dsl.edges.map(toFlowEdge);
}

function toFlowEdge(e: WorkflowEdge): Edge {
  const style = STYLES[e.kind];
  const label = LABELS[e.kind];
  const branchSuffix = e.branchIndex !== undefined ? `-${e.branchIndex}` : '';
  return {
    id: `${e.kind}-${e.from}-${e.to}${branchSuffix}`,
    source: e.from,
    target: e.to,
    type: 'default',
    data: { kind: e.kind, branchIndex: e.branchIndex },
    style,
    ...(label
      ? {
          label,
          labelStyle: { fontSize: 9, fill: style.stroke as string },
          labelBgStyle: { fill: 'rgba(255,255,255,0.9)' },
          labelBgPadding: [2, 2] as [number, number],
        }
      : {}),
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: style.stroke as string,
      width: 12,
      height: 12,
    },
  };
}
