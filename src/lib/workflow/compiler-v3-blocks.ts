import { buildGraphIndex, findEntryNodes, type GraphIndex } from './dsl-validator-graph';
import type { WorkflowDSLV3, WorkflowEdge, WorkflowNode } from './types-v3';

// ── Block tree ──────────────────────────────────────────────────────────────
//
// v3 编译的中间表示。validateDsl 已保证 DSL 结构合法 (控制流 SESE、parallel/join
// 配对、无非法环)。这里把"边图"折叠成"块树":
//
//   Leaf      单节点 (agent/notification/capability/wait/join/approval)
//   Sequence  顺序链 (通过 'next' 边串起来的一串)
//   IfElse    if-else head + then 分支 + else 分支 + 汇合点
//   Loop      for-each / while head + body 块
//   Parallel  parallel head + 并发 branch 块 + 对应 join
//
// 设计原则: 尽量少的递归/显式栈, 纯函数无副作用。

export type Block =
  | { kind: 'leaf'; nodeId: string }
  | { kind: 'sequence'; steps: Block[] }
  | { kind: 'if-else'; head: string; thenBlock: Block; elseBlock: Block; merge: string | null }
  | { kind: 'loop'; head: string; loopType: 'for-each' | 'while'; body: Block }
  | { kind: 'parallel'; head: string; join: string; branches: Block[] };

export function extractBlocks(dsl: WorkflowDSLV3): Block {
  const index = buildGraphIndex(dsl);
  const entries = findEntryNodes(index);
  if (entries.length !== 1) {
    throw new Error(`extractBlocks: expected exactly 1 entry node, got ${entries.length}`);
  }
  const result = walk(entries[0].id, new Set(), index);
  return normalize(result);
}

// ── Walk ────────────────────────────────────────────────────────────────────

function walk(startId: string | undefined, stopAt: Set<string>, index: GraphIndex): Block {
  const steps: Block[] = [];
  let current = startId;
  while (current && !stopAt.has(current)) {
    const node = index.nodeById.get(current);
    if (!node) break;
    if (isLeafType(node)) {
      steps.push({ kind: 'leaf', nodeId: current });
      current = nextEdge(index, current)?.to;
      continue;
    }
    if (node.type === 'if-else') {
      const block = buildIfElse(node, index);
      steps.push(block);
      current = block.kind === 'if-else' ? block.merge ?? undefined : undefined;
      continue;
    }
    if (node.type === 'for-each' || node.type === 'while') {
      const block = buildLoop(node, index);
      steps.push(block);
      current = nextEdge(index, node.id)?.to;
      continue;
    }
    if (node.type === 'parallel') {
      const block = buildParallel(node, index);
      steps.push(block);
      current = nextEdge(index, block.kind === 'parallel' ? block.join : node.id)?.to;
      continue;
    }
    break;
  }
  if (steps.length === 0) return { kind: 'sequence', steps: [] };
  if (steps.length === 1) return steps[0];
  return { kind: 'sequence', steps };
}

function isLeafType(node: WorkflowNode): boolean {
  return node.type === 'agent' || node.type === 'notification' || node.type === 'capability'
    || node.type === 'wait' || node.type === 'join' || node.type === 'approval';
}

function nextEdge(index: GraphIndex, id: string): WorkflowEdge | undefined {
  return index.outByKind.get(id)?.get('next')?.[0];
}

// ── If-else ─────────────────────────────────────────────────────────────────

function buildIfElse(node: WorkflowNode, index: GraphIndex): Block {
  const byKind = index.outByKind.get(node.id);
  const tStart = byKind?.get('then')?.[0]?.to;
  const eStart = byKind?.get('else')?.[0]?.to;
  const merge = tStart && eStart ? findMerge(index, tStart, eStart) : null;
  const stop = new Set(merge ? [merge] : []);
  const thenBlock = tStart ? walk(tStart, stop, index) : emptySeq();
  const elseBlock = eStart ? walk(eStart, stop, index) : emptySeq();
  return { kind: 'if-else', head: node.id, thenBlock, elseBlock, merge };
}

/**
 * 两个分支的最近汇合点。只沿前向控制流 (next/then/else) 搜索, 忽略 body 和 on-error:
 *   - body 边会把 BFS 带入/穿出循环体, 制造假汇合
 *   - on-error 是异常通道, 不参与正常汇合
 */
function findMerge(index: GraphIndex, a: string, b: string): string | null {
  const reachableB = reachableForward(index, b);
  const visited = new Set<string>();
  const queue = [a];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (id !== a && reachableB.has(id)) return id;
    for (const e of index.outEdges.get(id) ?? []) {
      if (e.kind === 'on-error' || e.kind === 'body') continue;
      queue.push(e.to);
    }
  }
  return null;
}

function reachableForward(index: GraphIndex, start: string): Set<string> {
  const visited = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const e of index.outEdges.get(id) ?? []) {
      if (e.kind === 'on-error' || e.kind === 'body') continue;
      queue.push(e.to);
    }
  }
  return visited;
}

// ── Loop ────────────────────────────────────────────────────────────────────

function buildLoop(node: WorkflowNode, index: GraphIndex): Block {
  const bodyStart = index.outByKind.get(node.id)?.get('body')?.[0]?.to;
  // body 子图在回到 loop head 时停止 (body 尾 → head 是回边)。
  const body = bodyStart ? walk(bodyStart, new Set([node.id]), index) : emptySeq();
  return {
    kind: 'loop',
    head: node.id,
    loopType: node.type as 'for-each' | 'while',
    body,
  };
}

// ── Parallel ────────────────────────────────────────────────────────────────

function buildParallel(node: WorkflowNode, index: GraphIndex): Block {
  const nextEdges = (index.outByKind.get(node.id)?.get('next') ?? [])
    .slice()
    .sort((a, b) => (a.branchIndex ?? 0) - (b.branchIndex ?? 0));
  const join = findJoin(index, node.id);
  if (!join) throw new Error(`parallel "${node.id}" has no matching join`);
  const stop = new Set([join]);
  const branches = nextEdges.map((e) => walk(e.to, stop, index));
  return { kind: 'parallel', head: node.id, join, branches };
}

/** 复用 validator 的匹配逻辑: BFS 带深度栈, parallel+1 / join-1, 遇到 depth=0 的 join 就是目标。 */
function findJoin(index: GraphIndex, parallelId: string): string | undefined {
  const queue: Array<{ id: string; depth: number }> = [];
  for (const e of index.outByKind.get(parallelId)?.get('next') ?? []) {
    queue.push({ id: e.to, depth: 0 });
  }
  const visited = new Set<string>();
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    const key = `${id}@${depth}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const node = index.nodeById.get(id);
    if (!node) continue;
    if (node.type === 'join' && depth === 0) return id;
    const nextDepth = node.type === 'parallel' ? depth + 1 : node.type === 'join' ? depth - 1 : depth;
    if (nextDepth < 0) continue;
    for (const e of index.outEdges.get(id) ?? []) {
      if (e.kind === 'on-error') continue;
      queue.push({ id: e.to, depth: nextDepth });
    }
  }
  return undefined;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function emptySeq(): Block {
  return { kind: 'sequence', steps: [] };
}

/** 展平空 sequence, 去掉长度为 1 的 sequence 包装。 */
function normalize(b: Block): Block {
  if (b.kind === 'sequence') {
    const flat: Block[] = [];
    for (const s of b.steps) {
      const n = normalize(s);
      if (n.kind === 'sequence' && n.steps.length === 0) continue;
      if (n.kind === 'sequence') flat.push(...n.steps);
      else flat.push(n);
    }
    if (flat.length === 0) return { kind: 'sequence', steps: [] };
    if (flat.length === 1) return flat[0];
    return { kind: 'sequence', steps: flat };
  }
  if (b.kind === 'if-else') {
    return { ...b, thenBlock: normalize(b.thenBlock), elseBlock: normalize(b.elseBlock) };
  }
  if (b.kind === 'loop') {
    return { ...b, body: normalize(b.body) };
  }
  if (b.kind === 'parallel') {
    return { ...b, branches: b.branches.map(normalize) };
  }
  return b;
}
