/**
 * V3 容器(if-else / for-each / while)的结构抽取与重写。
 *
 *   - extractIfElseBranches / extractBodyChain — 读取分支内的节点顺序
 *   - computeContainerOwnership — 回答"哪些节点归哪个容器"
 *   - rewriteContainerChain    — 重写指定分支的节点序列
 *   - computeTopLevelPredecessors / findContainerOwner — 顶层视图映射
 */
import type {
  WorkflowDSLV3,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeType,
} from './types-v3';
import {
  collectNextReachable,
  findOutgoingEdge,
  walkNextChainUntil,
} from './dsl-graph-v3-edges';

// ── 容器分支抽取 ────────────────────────────────────────────────────────────

export interface IfElseBranches {
  thenChain: string[];
  elseChain: string[];
}

/**
 * 抽取 if-else 容器的 then/else 体内节点顺序。
 * 规则: 沿 next 走, 停在另一条分支可达的首个节点(= 汇合点)。
 */
export function extractIfElseBranches(
  ifNodeId: string,
  edges: readonly WorkflowEdge[],
): IfElseBranches {
  const thenHead = findOutgoingEdge(edges, ifNodeId, 'then')?.to;
  const elseHead = findOutgoingEdge(edges, ifNodeId, 'else')?.to;

  const thenReach = thenHead ? collectNextReachable(thenHead, edges) : new Set<string>();
  const elseReach = elseHead ? collectNextReachable(elseHead, edges) : new Set<string>();

  const thenChain = thenHead
    ? walkNextChainUntil(thenHead, edges, (id) => id !== thenHead && elseReach.has(id))
    : [];
  const elseChain = elseHead
    ? walkNextChainUntil(elseHead, edges, (id) => id !== elseHead && thenReach.has(id))
    : [];

  const safeThen = thenHead && elseReach.has(thenHead) ? [] : thenChain;
  const safeElse = elseHead && thenReach.has(elseHead) ? [] : elseChain;
  return { thenChain: safeThen, elseChain: safeElse };
}

/** 抽取 for-each / while 的循环体节点顺序(沿 body 头一路走 next, 不跨循环回边)。 */
export function extractBodyChain(
  loopNodeId: string,
  edges: readonly WorkflowEdge[],
): string[] {
  const head = findOutgoingEdge(edges, loopNodeId, 'body')?.to;
  if (!head) return [];
  return walkNextChainUntil(head, edges, () => false);
}

// ── 容器归属 ────────────────────────────────────────────────────────────────

export interface ContainerOwnership {
  /** container id → 直接归属 (body / then / else chain) 的节点 id 集合. */
  childrenByContainer: Map<string, { then?: string[]; else?: string[]; body?: string[] }>;
  /** 被任意容器拥有的节点 id (包含嵌套层). */
  ownedIds: Set<string>;
  /** 子节点 → 直接父容器 id (顶层节点无项). */
  parentByChild: Map<string, string>;
}

export function computeContainerOwnership(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): ContainerOwnership {
  const childrenByContainer = new Map<string, { then?: string[]; else?: string[]; body?: string[] }>();
  const ownedIds = new Set<string>();
  const parentByChild = new Map<string, string>();
  for (const node of nodes) {
    if (node.type === 'if-else') {
      const { thenChain, elseChain } = extractIfElseBranches(node.id, edges);
      childrenByContainer.set(node.id, { then: thenChain, else: elseChain });
      for (const id of thenChain) { ownedIds.add(id); parentByChild.set(id, node.id); }
      for (const id of elseChain) { ownedIds.add(id); parentByChild.set(id, node.id); }
    } else if (node.type === 'for-each' || node.type === 'while') {
      const body = extractBodyChain(node.id, edges);
      childrenByContainer.set(node.id, { body });
      for (const id of body) { ownedIds.add(id); parentByChild.set(id, node.id); }
    }
  }
  return { childrenByContainer, ownedIds, parentByChild };
}

export function isContainerNodeType(type: WorkflowNodeType | string): boolean {
  return type === 'if-else' || type === 'for-each' || type === 'while';
}

// ── 分支重写 (BodyManager reorder / add / remove 用) ────────────────────────

export interface ContainerChainUpdate {
  /** if-else 的 then 分支. */
  then?: string[];
  /** if-else 的 else 分支. */
  else?: string[];
  /** for-each / while 的 body 链. */
  body?: string[];
}

/**
 * 把 container 的某条分支重写成 `order` 给定的节点序列。
 * 替换该分支的入口边 (then/else/body) 和其内部的 next 链;
 * 原分支最末节点若有 next 出边接到汇合点, 会保留该汇合目标。
 * 其它边(容器外 next / on-error / 其它分支)保持不变。
 */
export function rewriteContainerChain(
  containerId: string,
  kind: 'then' | 'else' | 'body',
  order: string[],
  dsl: WorkflowDSLV3,
): WorkflowDSLV3 {
  const prevChain = extractChainForKind(containerId, kind, dsl.edges);
  const mergeTarget = resolveChainSuccessor(prevChain, dsl.edges);

  const prevChainSet = new Set(prevChain);
  const filtered = dsl.edges.filter((edge) => {
    if (edge.from === containerId && edge.kind === kind) return false;
    if (edge.kind !== 'next') return true;
    if (!prevChainSet.has(edge.from)) return true;
    const prevIdx = prevChain.indexOf(edge.from);
    const expectedNext = prevIdx + 1 < prevChain.length ? prevChain[prevIdx + 1] : mergeTarget;
    if (expectedNext && edge.to === expectedNext) return false;
    return true;
  });

  const rebuilt: WorkflowEdge[] = [];
  if (order.length > 0) {
    rebuilt.push({ from: containerId, to: order[0], kind });
    for (let i = 0; i < order.length - 1; i += 1) {
      rebuilt.push({ from: order[i], to: order[i + 1], kind: 'next' });
    }
    if (mergeTarget) {
      rebuilt.push({ from: order[order.length - 1], to: mergeTarget, kind: 'next' });
    }
  } else if (mergeTarget) {
    rebuilt.push({ from: containerId, to: mergeTarget, kind });
  }

  return { ...dsl, edges: [...filtered, ...rebuilt] };
}

function extractChainForKind(
  containerId: string,
  kind: 'then' | 'else' | 'body',
  edges: readonly WorkflowEdge[],
): string[] {
  if (kind === 'body') return extractBodyChain(containerId, edges);
  const branches = extractIfElseBranches(containerId, edges);
  return kind === 'then' ? branches.thenChain : branches.elseChain;
}

function resolveChainSuccessor(
  chain: readonly string[],
  edges: readonly WorkflowEdge[],
): string | undefined {
  if (chain.length === 0) return undefined;
  const tail = chain[chain.length - 1];
  const tailNext = findOutgoingEdge(edges, tail, 'next')?.to;
  if (tailNext && !chain.includes(tailNext)) return tailNext;
  return undefined;
}

// ── 顶层前驱推导 ────────────────────────────────────────────────────────────

/**
 * 每个节点的顶层前驱集合 —— 用于向老 UI 展示 "谁先运行"。
 * 若前驱属于某 container, 返回 container 自身 id。
 */
export function computeTopLevelPredecessors(
  edges: readonly WorkflowEdge[],
  ownedIds: Set<string>,
): Map<string, string[]> {
  const out = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.kind !== 'next') continue;
    const fromTop = hoistToTopLevel(edge.from, ownedIds, edges);
    if (!fromTop) continue;
    const set = out.get(edge.to) ?? new Set<string>();
    set.add(fromTop);
    out.set(edge.to, set);
  }
  const result = new Map<string, string[]>();
  for (const [id, set] of out) result.set(id, Array.from(set));
  return result;
}

function hoistToTopLevel(
  id: string,
  ownedIds: Set<string>,
  edges: readonly WorkflowEdge[],
): string | null {
  let cursor: string | undefined = id;
  const seen = new Set<string>();
  while (cursor && ownedIds.has(cursor) && !seen.has(cursor)) {
    seen.add(cursor);
    cursor = findContainerOwner(cursor, edges);
  }
  return cursor ?? null;
}

export function findContainerOwner(id: string, edges: readonly WorkflowEdge[]): string | undefined {
  for (const e of edges) {
    if (e.to === id && (e.kind === 'then' || e.kind === 'else' || e.kind === 'body')) {
      return e.from;
    }
  }
  return undefined;
}
