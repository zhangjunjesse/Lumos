import type { Edge } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import { extractDataRefs } from './dsl-data-refs';
import { computeContainerOwnership, isContainerNodeType } from './dsl-graph-v3-helpers';
import type { EdgeKind as DslEdgeKind, WorkflowDSLV3, WorkflowEdge } from './types-v3';

// ── Visual edge model ──────────────────────────────────────────────────────
//
// DSL 边(WorkflowEdge.kind) 直接映射成可视边,另加两种"派生"视觉线:
//   next       · 默认深灰实线
//   then       · 绿色 "then ✓"
//   else       · 橙色 "else ✗"
//   body       · 蓝色 "↻ body"
//   on-error   · 红色虚线 "⚠ on-error"
//   loop-back  · 派生: body 尾 → loop, 默认隐藏, hover 时显现
//   ref        · 派生: steps.X.output 引用, 可 toggle

export type EdgeKind =
  | 'next' | 'then' | 'else' | 'body' | 'on-error' | 'loop-back' | 'ref';

const STYLES: Record<EdgeKind, Record<string, unknown>> = {
  next:       { stroke: '#64748b', strokeWidth: 1.5 },
  then:       { stroke: '#10b981', strokeWidth: 1.6 },
  else:       { stroke: '#f97316', strokeWidth: 1.6 },
  body:       { stroke: '#0ea5e9', strokeWidth: 1.6 },
  'on-error': { stroke: '#ef4444', strokeWidth: 1.5, strokeDasharray: '6 3' },
  'loop-back': { stroke: '#0ea5e9', strokeWidth: 1.3, strokeDasharray: '5 4' },
  ref:         { stroke: '#cbd5e1', strokeWidth: 1.2, strokeDasharray: '5 4', opacity: 0.85 },
};

const LABELS: Partial<Record<EdgeKind, string>> = {
  then: 'then ✓',
  else: 'else ✗',
  body: '↻ body',
  'on-error': '⚠ on-error',
  'loop-back': '↺ loop',
};

function edgeIdFor(kind: EdgeKind, from: string, to: string, branchIndex?: number): string {
  const suffix = typeof branchIndex === 'number' ? `-${branchIndex}` : '';
  return `${kind}-${from}-${to}${suffix}`;
}

function makeEdge(
  kind: EdgeKind,
  source: string,
  target: string,
  opts: { branchIndex?: number; label?: string } = {},
): Edge {
  const interactive = kind === 'next' || kind === 'on-error';
  const baseLabel = LABELS[kind];
  const label = opts.label ?? baseLabel;
  return {
    id: edgeIdFor(kind, source, target, opts.branchIndex),
    source,
    target,
    type: kind === 'loop-back' ? 'smoothstep' : 'default',
    data: { kind, ...(opts.branchIndex !== undefined ? { branchIndex: opts.branchIndex } : {}) },
    style: STYLES[kind],
    ...(label
      ? {
          label,
          labelStyle: { fontSize: 9, fill: STYLES[kind].stroke as string },
          labelBgStyle: { fill: 'rgba(255,255,255,0.9)' },
          labelBgPadding: [2, 2] as [number, number],
        }
      : {}),
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: STYLES[kind].stroke as string,
      width: 12,
      height: 12,
    },
    ...(kind === 'loop-back' ? { hidden: true } : {}),
    ...(interactive ? {} : { selectable: false, focusable: false, deletable: false }),
  };
}

// ── V3 DSL edge → visual edge ──────────────────────────────────────────────

function labelForDslEdge(edge: WorkflowEdge, parallelIds: Set<string>): string | undefined {
  if (edge.kind === 'next' && parallelIds.has(edge.from)) {
    return typeof edge.branchIndex === 'number' ? `分支 ${edge.branchIndex + 1}` : '分支';
  }
  return LABELS[edge.kind as EdgeKind];
}

/**
 * 把 V3 DSL 边 + 派生视觉边(loop-back / ref) 一起编成 React Flow 边。
 * 优先级: DSL 边 > loop-back > ref。同 (from,to,kind) 重复去重。
 */
export function buildVisualEdges(dsl: WorkflowDSLV3): Edge[] {
  const taken = new Set<string>();
  const parallelIds = new Set(dsl.nodes.filter((n) => n.type === 'parallel').map((n) => n.id));
  const out: Edge[] = [];
  const push = (edge: Edge) => {
    if (taken.has(edge.id)) return;
    taken.add(edge.id);
    out.push(edge);
  };

  for (const e of dsl.edges) {
    const label = labelForDslEdge(e, parallelIds);
    push(makeEdge(e.kind as EdgeKind, e.from, e.to, {
      branchIndex: e.branchIndex,
      ...(label ? { label } : {}),
    }));
  }

  pushLoopBackEdges(dsl, push);
  pushRefEdges(dsl, push);

  return out;
}

function pushLoopBackEdges(dsl: WorkflowDSLV3, push: (edge: Edge) => void): void {
  for (const node of dsl.nodes) {
    if (node.type !== 'for-each' && node.type !== 'while') continue;
    const body = collectLoopBody(node.id, dsl.edges);
    if (body.length === 0) continue;
    push(makeEdge('loop-back', body[body.length - 1], node.id));
  }
}

function collectLoopBody(loopId: string, edges: readonly WorkflowEdge[]): string[] {
  const head = edges.find((e) => e.from === loopId && e.kind === 'body')?.to;
  if (!head) return [];
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = head;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    chain.push(cursor);
    const next = edges.find((e) => e.from === cursor && e.kind === 'next');
    cursor = next?.to;
  }
  return chain;
}

function pushRefEdges(dsl: WorkflowDSLV3, push: (edge: Edge) => void): void {
  const ownership = computeContainerOwnership(dsl.nodes, dsl.edges);
  const ids = new Set(dsl.nodes.map((n) => n.id));
  for (const node of dsl.nodes) {
    const stepLike = { id: node.id, input: (node as { input?: unknown }).input };
    for (const src of extractDataRefs(stepLike, ids)) {
      const sourceParent = ownership.parentByChild.get(src);
      const targetParent = ownership.parentByChild.get(node.id);
      if (sourceParent && sourceParent === targetParent) {
        push(makeEdge('ref', src, node.id));
        continue;
      }
      push(makeEdge('ref', src, node.id));
    }
  }
}

/** 旧名兼容 — `dslToGraph` 调用点用这个名字。 */
export const buildEdges = buildVisualEdges;

// ── 便捷: dsl edge kind 列表 (给 canvas-helpers 用) ─────────────────────────

export const DSL_EDGE_KINDS: DslEdgeKind[] = ['next', 'then', 'else', 'body', 'on-error'];

// ── 便捷: 判断某节点类型是否容器 (UI 侧复用) ────────────────────────────────

export { isContainerNodeType };
