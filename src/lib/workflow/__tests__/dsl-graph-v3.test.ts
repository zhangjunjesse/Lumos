/**
 * V3 编辑主链回归测试 —— 覆盖"加载 → 编辑 → JSON → 保存 → 重开"闭环,
 * 外加高级边语义 (on-error / parallel branchIndex / approval goto) 的 round-trip。
 *
 * 目的:这条主链是编辑器最脆弱的信息通道,任何一段对 V3 图数据保真不足都会
 * 导致用户编辑丢失 —— 所以测试直接走 graphToDsl ↔ dslToGraph 真实通路。
 */
import { dslToGraph, graphToDsl, removeNodeFromDsl } from '../dsl-graph-converter';
import {
  extractBodyChain,
  extractIfElseBranches,
  extractParallelBranches,
  findOnErrorTarget,
  reorderParallelBranches,
  rewriteContainerChain,
  syncOnErrorEdge,
} from '../dsl-graph-v3-helpers';
import type {
  WorkflowDSLV3,
  WorkflowEdge,
  WorkflowNode,
} from '../types-v3';

// ── Builders ────────────────────────────────────────────────────────────────

const agent = (id: string, input: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type: 'agent', input: { prompt: `p-${id}`, ...input } } as WorkflowNode);

const edge = (from: string, to: string, kind: WorkflowEdge['kind'], extras: Partial<WorkflowEdge> = {}): WorkflowEdge =>
  ({ from, to, kind, ...extras });

const v3 = (nodes: WorkflowNode[], edges: WorkflowEdge[], name = 't'): WorkflowDSLV3 =>
  ({ version: 'v3', name, nodes, edges });

/** 线性: a → b → c */
function linear(): WorkflowDSLV3 {
  return v3(
    [agent('a'), agent('b'), agent('c')],
    [edge('a', 'b', 'next'), edge('b', 'c', 'next')],
  );
}

/** if-else 分支: head → (then: [y1, y2] / else: [n1]) → merge */
function ifElse(): WorkflowDSLV3 {
  return v3(
    [
      agent('setup'),
      { id: 'gate', type: 'if-else', input: { condition: { op: 'exists', ref: 'input.flag' } } } as WorkflowNode,
      agent('y1'),
      agent('y2'),
      agent('n1'),
      agent('merge'),
    ],
    [
      edge('setup', 'gate', 'next'),
      edge('gate', 'y1', 'then'),
      edge('y1', 'y2', 'next'),
      edge('y2', 'merge', 'next'),
      edge('gate', 'n1', 'else'),
      edge('n1', 'merge', 'next'),
    ],
  );
}

/** for-each 循环: head -body-> step1 → step2, head → after */
function forEach(): WorkflowDSLV3 {
  return v3(
    [
      { id: 'loop', type: 'for-each', input: { collection: 'input.items', itemVar: 'item' } } as WorkflowNode,
      agent('step1'),
      agent('step2'),
      agent('after'),
    ],
    [
      edge('loop', 'step1', 'body'),
      edge('step1', 'step2', 'next'),
      edge('loop', 'after', 'next'),
    ],
  );
}

/** parallel + join, 三路分支,带 branchIndex */
function parallel(): WorkflowDSLV3 {
  return v3(
    [
      { id: 'fan', type: 'parallel', input: {} } as WorkflowNode,
      agent('a'),
      agent('b'),
      agent('c'),
      { id: 'sync', type: 'join', input: {} } as WorkflowNode,
      agent('tail'),
    ],
    [
      edge('fan', 'a', 'next', { branchIndex: 0 }),
      edge('fan', 'b', 'next', { branchIndex: 1 }),
      edge('fan', 'c', 'next', { branchIndex: 2 }),
      edge('a', 'sync', 'next'),
      edge('b', 'sync', 'next'),
      edge('c', 'sync', 'next'),
      edge('sync', 'tail', 'next'),
    ],
  );
}

// ── 主链 round-trip ────────────────────────────────────────────────────────

describe('editor main chain: load → edit (no-op) → save round-trips DSL', () => {
  it('linear: graphToDsl ∘ dslToGraph preserves nodes and edges', () => {
    const original = linear();
    const { nodes, edges } = dslToGraph(original);
    const next = graphToDsl(nodes, edges, original);
    expect(next.version).toBe('v3');
    expect(next.nodes.map((n) => n.id)).toEqual(original.nodes.map((n) => n.id));
    expect(next.edges.map(stripPosition)).toEqual(original.edges);
  });

  it('if-else: then/else chains survive round-trip', () => {
    const original = ifElse();
    const { nodes, edges } = dslToGraph(original);
    const next = graphToDsl(nodes, edges, original);
    const { thenChain, elseChain } = extractIfElseBranches('gate', next.edges);
    expect(thenChain).toEqual(['y1', 'y2']);
    expect(elseChain).toEqual(['n1']);
  });

  it('for-each: body chain preserved', () => {
    const original = forEach();
    const { nodes, edges } = dslToGraph(original);
    const next = graphToDsl(nodes, edges, original);
    expect(extractBodyChain('loop', next.edges)).toEqual(['step1', 'step2']);
    expect(next.edges.some((e) => e.from === 'loop' && e.to === 'after' && e.kind === 'next')).toBe(true);
  });

  it('parallel: branchIndex survives round-trip', () => {
    const original = parallel();
    const { nodes, edges } = dslToGraph(original);
    const next = graphToDsl(nodes, edges, original);
    const branches = extractParallelBranches('fan', next.edges);
    expect(branches.map((b) => b.targetId)).toEqual(['a', 'b', 'c']);
    expect(branches.map((b) => b.branchIndex)).toEqual([0, 1, 2]);
  });

  it('JSON string survives full round-trip (load → save → reload)', () => {
    const original = ifElse();
    const jsonA = JSON.stringify(original);
    const { nodes, edges } = dslToGraph(original);
    const nextDsl = graphToDsl(nodes, edges, original);
    const jsonB = JSON.stringify({
      version: nextDsl.version,
      name: nextDsl.name,
      nodes: nextDsl.nodes.map((n) => ({ ...n, metadata: undefined })),
      edges: nextDsl.edges,
    });
    // 节点里可能新增 metadata.position,但 nodes/edges 语义不变
    const parsed = JSON.parse(jsonB) as WorkflowDSLV3;
    expect(parsed.nodes.map((n) => n.id).sort()).toEqual(
      JSON.parse(jsonA).nodes.map((n: WorkflowNode) => n.id).sort(),
    );
    expect(parsed.edges).toEqual(original.edges);
  });
});

// ── 图编辑操作回路 ──────────────────────────────────────────────────────────

describe('graph edits on V3 DSL', () => {
  it('removeNodeFromDsl relinks next predecessors to next successor', () => {
    const next = removeNodeFromDsl(linear(), 'b');
    expect(next.nodes.map((n) => n.id)).toEqual(['a', 'c']);
    const rebuiltEdge = next.edges.find(
      (e) => e.from === 'a' && e.to === 'c' && e.kind === 'next',
    );
    expect(rebuiltEdge).toBeDefined();
  });

  it('removeNodeFromDsl on container clears branch + drops it', () => {
    const next = removeNodeFromDsl(ifElse(), 'gate');
    expect(next.nodes.map((n) => n.id)).toEqual(['setup', 'y1', 'y2', 'n1', 'merge']);
    // gate 的 then/else 边应全部被清除
    const gateEdges = next.edges.filter((e) => e.from === 'gate' || e.to === 'gate');
    expect(gateEdges).toHaveLength(0);
  });

  it('rewriteContainerChain swaps then-branch contents', () => {
    const next = rewriteContainerChain('gate', 'then', ['y2', 'y1'], ifElse());
    const { thenChain, elseChain } = extractIfElseBranches('gate', next.edges);
    expect(thenChain).toEqual(['y2', 'y1']);
    expect(elseChain).toEqual(['n1']);
  });

  it('reorderParallelBranches rewrites branchIndex to match given order', () => {
    const next = reorderParallelBranches(parallel(), 'fan', ['c', 'a', 'b']);
    const branches = extractParallelBranches('fan', next.edges);
    expect(branches.map((b) => b.targetId)).toEqual(['c', 'a', 'b']);
    expect(branches.map((b) => b.branchIndex)).toEqual([0, 1, 2]);
  });
});

// ── 高级语义 round-trip ────────────────────────────────────────────────────

describe('advanced edges (on-error / approval goto)', () => {
  it('on-error edge survives load → save cycle', () => {
    const original = v3(
      [
        agent('risky', {}),
        agent('fallback', {}),
      ],
      [edge('risky', 'fallback', 'on-error')],
    );
    (original.nodes[0] as WorkflowNode).onError = { action: 'goto', target: 'fallback' };

    const { nodes, edges } = dslToGraph(original);
    const next = graphToDsl(nodes, edges, original);
    expect(findOnErrorTarget(next.edges, 'risky')).toBe('fallback');
    // 保存后节点 onError 元数据仍在
    expect((next.nodes.find((n) => n.id === 'risky')?.onError ?? null)?.target).toBe('fallback');
  });

  it('syncOnErrorEdge adds edge when action=goto with valid target', () => {
    const base = v3([agent('r'), agent('h')], []);
    const withOnError: WorkflowDSLV3 = {
      ...base,
      nodes: base.nodes.map((n) =>
        n.id === 'r' ? { ...n, onError: { action: 'goto', target: 'h' } } : n,
      ) as WorkflowNode[],
    };
    const next = syncOnErrorEdge(withOnError, 'r');
    expect(findOnErrorTarget(next.edges, 'r')).toBe('h');
  });

  it('syncOnErrorEdge removes on-error edge when action flips to fail', () => {
    const start = v3(
      [
        { ...agent('r'), onError: { action: 'fail' } } as WorkflowNode,
        agent('h'),
      ],
      [edge('r', 'h', 'on-error')],
    );
    const next = syncOnErrorEdge(start, 'r');
    expect(findOnErrorTarget(next.edges, 'r')).toBeUndefined();
  });

  it('syncOnErrorEdge drops edge when target no longer exists', () => {
    const start = v3(
      [
        { ...agent('r'), onError: { action: 'goto', target: 'missing' } } as WorkflowNode,
      ],
      [edge('r', 'missing', 'on-error')],
    );
    const next = syncOnErrorEdge(start, 'r');
    expect(findOnErrorTarget(next.edges, 'r')).toBeUndefined();
  });
});

// ── helpers ────────────────────────────────────────────────────────────────

function stripPosition(e: WorkflowEdge): WorkflowEdge {
  // edges have no position; returning as-is keeps the intent explicit.
  return e;
}
