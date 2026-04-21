import dagre from 'dagre';

// ── Rendering constants ────────────────────────────────────────────────────

export const NODE_W = 180;
export const NODE_H = 52;
export const NODE_H_SM = 44;
export const GAP_X = 52;
export const GAP_Y = 28;

// ── Types ──────────────────────────────────────────────────────────────────

export interface NodePos { x: number; y: number }

export interface LayoutEdge {
  source: string;
  target: string;
  /** 不参与布局的边 (loop-back / ref) 会被过滤掉 */
  data?: { kind?: string };
}

// ── Flat dagre layout ──────────────────────────────────────────────────────

/** 布局只需要 id + type 两个字段;兼容 v3 WorkflowNode. */
interface LayoutNodeLike {
  id: string;
  type: string;
}

/**
 * 把所有节点作为平级节点用 dagre 单次布局。
 * body/then/else 关系靠边表达,不再嵌套渲染。
 *
 * `visualEdges` 应该是已经构好的 React Flow 边数组。
 * 布局时会过滤掉 loop-back / ref (视觉辅助边,不应影响排版)。
 */
export function computeLayout<T extends LayoutNodeLike>(
  steps: readonly T[],
  visualEdges: readonly LayoutEdge[],
): Map<string, NodePos> {
  const positions = new Map<string, NodePos>();
  if (steps.length === 0) return positions;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: GAP_Y, ranksep: GAP_X, marginx: 20, marginy: 20 });

  for (const s of steps) {
    g.setNode(s.id, { width: NODE_W, height: nodeHeight(s) });
  }

  const ids = new Set(steps.map(s => s.id));
  for (const e of visualEdges) {
    const kind = e.data?.kind;
    if (kind === 'loop-back' || kind === 'ref') continue;
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  for (const s of steps) {
    const n = g.node(s.id);
    if (!n) continue;
    positions.set(s.id, { x: n.x - NODE_W / 2, y: n.y - nodeHeight(s) / 2 });
  }
  return positions;
}

function nodeHeight(step: LayoutNodeLike): number {
  return step.type === 'wait' ? NODE_H_SM : NODE_H;
}
