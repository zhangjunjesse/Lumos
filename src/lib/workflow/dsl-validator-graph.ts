import type { EdgeKind, WorkflowDSLV3, WorkflowEdge, WorkflowNode } from './types-v3';

// ── Graph adjacency helpers ─────────────────────────────────────────────────
//
// 纯只读工具。结构校验器 (dsl-validator.ts) 和 runtime 共用这套索引,
// 避免每条规则各自重复扫边。

export interface GraphIndex {
  nodeById: Map<string, WorkflowNode>;
  outEdges: Map<string, WorkflowEdge[]>;
  inEdges: Map<string, WorkflowEdge[]>;
  /** 归类后的 adjacency, 便于按 EdgeKind 查。 */
  outByKind: Map<string, Map<EdgeKind, WorkflowEdge[]>>;
  inByKind: Map<string, Map<EdgeKind, WorkflowEdge[]>>;
}

export function buildGraphIndex(dsl: WorkflowDSLV3): GraphIndex {
  const nodeById = new Map<string, WorkflowNode>();
  const outEdges = new Map<string, WorkflowEdge[]>();
  const inEdges = new Map<string, WorkflowEdge[]>();
  const outByKind = new Map<string, Map<EdgeKind, WorkflowEdge[]>>();
  const inByKind = new Map<string, Map<EdgeKind, WorkflowEdge[]>>();

  for (const node of dsl.nodes) {
    nodeById.set(node.id, node);
    outEdges.set(node.id, []);
    inEdges.set(node.id, []);
    outByKind.set(node.id, new Map());
    inByKind.set(node.id, new Map());
  }

  for (const edge of dsl.edges) {
    outEdges.get(edge.from)?.push(edge);
    inEdges.get(edge.to)?.push(edge);
    pushKind(outByKind.get(edge.from), edge.kind, edge);
    pushKind(inByKind.get(edge.to), edge.kind, edge);
  }

  return { nodeById, outEdges, inEdges, outByKind, inByKind };
}

function pushKind(
  map: Map<EdgeKind, WorkflowEdge[]> | undefined,
  kind: EdgeKind,
  edge: WorkflowEdge,
): void {
  if (!map) return;
  const arr = map.get(kind) ?? [];
  arr.push(edge);
  map.set(kind, arr);
}

// ── Entry / reachability ────────────────────────────────────────────────────

/**
 * 入口节点 = 入度 (非 on-error) 为 0 的节点。on-error 是异常分支, 不算正常入度。
 */
export function findEntryNodes(index: GraphIndex): WorkflowNode[] {
  const entries: WorkflowNode[] = [];
  for (const node of index.nodeById.values()) {
    const incoming = index.inEdges.get(node.id) ?? [];
    const normalIn = incoming.filter((e) => e.kind !== 'on-error');
    if (normalIn.length === 0) entries.push(node);
  }
  return entries;
}

/**
 * 从给定起点 BFS 可达节点集合 (包括 on-error 边)。
 */
export function reachableFrom(index: GraphIndex, startIds: string[]): Set<string> {
  const visited = new Set<string>();
  const queue = [...startIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const edge of index.outEdges.get(id) ?? []) {
      if (!visited.has(edge.to)) queue.push(edge.to);
    }
  }
  return visited;
}

// ── Topological predecessor set (不含 on-error 异常通道) ────────────────────
//
// 用于校验 `{{ steps.X.output.* }}` 的 X 必须是 target 的严格前驱。
// 通过普通控制边 (next/then/else/body) 可达, 异常通道 (on-error) 不计入前驱。

export function computeTopoPredecessors(index: GraphIndex): Map<string, Set<string>> {
  // Kahn 式拓扑排序, 同时维护 predecessor 集合。由于 body 边可能形成循环
  // (runtime loop-back 不在 edges 里, 但人为写 body→...→loop-head 会构成环),
  // 这里**忽略进入 loop 节点 body 边**以外的反向情形, 由环检测单独处理。

  const preds = new Map<string, Set<string>>();
  for (const id of index.nodeById.keys()) preds.set(id, new Set());

  const indeg = new Map<string, number>();
  for (const [id, edges] of index.inEdges) {
    const normalIn = edges.filter((e) => e.kind !== 'on-error');
    indeg.set(id, normalIn.length);
  }

  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  while (queue.length > 0) {
    const id = queue.shift()!;
    const out = index.outEdges.get(id) ?? [];
    for (const edge of out) {
      if (edge.kind === 'on-error') continue;
      const target = edge.to;
      const tgtPred = preds.get(target);
      if (!tgtPred) continue; // edge points to unknown node; reported elsewhere
      tgtPred.add(id);
      for (const p of preds.get(id) ?? []) tgtPred.add(p);
      indeg.set(target, (indeg.get(target) ?? 0) - 1);
      if (indeg.get(target) === 0) queue.push(target);
    }
  }

  return preds;
}

// ── Cycle detection (除 loop-head 的 body 环) ──────────────────────────────
//
// body 边进入循环头是合法的 runtime 回边; 其他环都是非法的。这里检测
// 所有非 body/on-error 边能否构成环 → 构成则违法。

export function findIllegalCycles(index: GraphIndex): string[][] {
  const cycles: string[][] = [];
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of index.nodeById.keys()) color.set(id, WHITE);

  const stack: string[] = [];
  const dfs = (id: string): void => {
    color.set(id, GRAY);
    stack.push(id);
    for (const edge of index.outEdges.get(id) ?? []) {
      if (edge.kind === 'on-error' || edge.kind === 'body') continue;
      const c = color.get(edge.to) ?? WHITE;
      if (c === GRAY) {
        const cutIdx = stack.indexOf(edge.to);
        cycles.push(stack.slice(cutIdx).concat(edge.to));
      } else if (c === WHITE) {
        dfs(edge.to);
      }
    }
    color.set(id, BLACK);
    stack.pop();
  };

  for (const id of index.nodeById.keys()) {
    if (color.get(id) === WHITE) dfs(id);
  }
  return cycles;
}
