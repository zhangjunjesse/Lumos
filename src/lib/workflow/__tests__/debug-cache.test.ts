import {
  buildConfigHashes,
  buildDebugRuntimeContext,
  buildResumeRuntimeContext,
  computeConfigHash,
  computeTransitiveDownstream,
  computeUpstreamClosure,
} from '../debug-cache';
import type { DebugStepOutput } from '../debug-types';
import type {
  IfElseNode,
  WorkflowDSLV3,
  WorkflowEdge,
  WorkflowNode,
  WhileNode,
} from '../types-v3';

// ── Helpers (V3-native DSL builders) ────────────────────────────────────────

function agent(id: string, extras: Partial<WorkflowNode> = {}): WorkflowNode {
  return {
    id,
    type: 'agent',
    input: { prompt: `p-${id}` },
    ...extras,
  } as WorkflowNode;
}

function ifElse(id: string, extras: Partial<IfElseNode> = {}): IfElseNode {
  return {
    id,
    type: 'if-else',
    input: { condition: { op: 'exists', ref: 'input.flag' } },
    ...extras,
  };
}

function whileNode(id: string, extras: Partial<WhileNode> = {}): WhileNode {
  return {
    id,
    type: 'while',
    input: { condition: { op: 'exists', ref: 'state.x' } },
    ...extras,
  };
}

function edge(
  from: string,
  to: string,
  kind: WorkflowEdge['kind'],
): WorkflowEdge {
  return { from, to, kind };
}

function v3(nodes: WorkflowNode[], edges: WorkflowEdge[], name: string): WorkflowDSLV3 {
  return { version: 'v3', name, nodes, edges };
}

// a → b → c → d (linear next chain)
function linear(): WorkflowDSLV3 {
  return v3(
    [agent('a'), agent('b'), agent('c'), agent('d')],
    [edge('a', 'b', 'next'), edge('b', 'c', 'next'), edge('c', 'd', 'next')],
    'linear',
  );
}

// setup → gate(if-else) → then[work-a → work-b] / else[fallback] → finish
function dslWithIfElse(): WorkflowDSLV3 {
  return v3(
    [
      agent('setup'),
      ifElse('gate'),
      agent('work-a'),
      agent('work-b'),
      agent('fallback'),
      agent('finish'),
    ],
    [
      edge('setup', 'gate', 'next'),
      edge('gate', 'work-a', 'then'),
      edge('work-a', 'work-b', 'next'),
      edge('work-b', 'finish', 'next'),
      edge('gate', 'fallback', 'else'),
      edge('fallback', 'finish', 'next'),
    ],
    'if-else nested',
  );
}

// prep → outer-if → then[loop(while, body=[inner])] → end; else branch goes to end.
function dslWithNestedWhile(): WorkflowDSLV3 {
  return v3(
    [
      agent('prep'),
      ifElse('outer-if'),
      whileNode('loop'),
      agent('inner'),
      agent('end'),
    ],
    [
      edge('prep', 'outer-if', 'next'),
      edge('outer-if', 'loop', 'then'),
      edge('loop', 'end', 'next'),
      edge('outer-if', 'end', 'else'),
      edge('loop', 'inner', 'body'),
    ],
    'nested',
  );
}

function stubCache(stepId: string, configHash: string): DebugStepOutput {
  return {
    sessionId: 'sess',
    stepId,
    output: {},
    metadata: {},
    status: 'success',
    durationMs: 0,
    completedAt: '2024-01-01',
    configHash,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('computeConfigHash', () => {
  it('returns the same hash for identical (input/policy) config', () => {
    const a = agent('x', { input: { prompt: 'hi' }, policy: { timeoutMs: 1000 } });
    const b = agent('x', { input: { prompt: 'hi' }, policy: { timeoutMs: 1000 } });
    expect(computeConfigHash(a)).toBe(computeConfigHash(b));
  });

  it('changes when input changes', () => {
    const a = agent('x', { input: { prompt: 'hi' } });
    const b = agent('x', { input: { prompt: 'BYE' } });
    expect(computeConfigHash(a)).not.toBe(computeConfigHash(b));
  });

  it('ignores metadata.position (cosmetic-only)', () => {
    const a = agent('x', { metadata: { position: { x: 0, y: 0 } } });
    const b = agent('x', { metadata: { position: { x: 999, y: 999 } } });
    expect(computeConfigHash(a)).toBe(computeConfigHash(b));
  });
});

describe('computeUpstreamClosure', () => {
  it('collects transitive chain in a linear DSL', () => {
    const upstream = computeUpstreamClosure('c', linear());
    expect(upstream).toEqual(new Set(['a', 'b']));
  });

  it('does not include target itself', () => {
    const upstream = computeUpstreamClosure('c', linear());
    expect(upstream.has('c')).toBe(false);
  });

  it('does not include downstream nodes', () => {
    const upstream = computeUpstreamClosure('c', linear());
    expect(upstream.has('d')).toBe(false);
  });

  it('walks prior siblings inside an if-else then-branch and includes the container', () => {
    const upstream = computeUpstreamClosure('work-b', dslWithIfElse());
    expect(upstream.has('work-a')).toBe(true);
    expect(upstream.has('gate')).toBe(true);
    expect(upstream.has('setup')).toBe(true);
    expect(upstream.has('fallback')).toBe(false);
    expect(upstream.has('finish')).toBe(false);
  });

  it('handles nested containers — inner loop body pulls in both outer-if and loop', () => {
    const upstream = computeUpstreamClosure('inner', dslWithNestedWhile());
    expect(upstream.has('loop')).toBe(true);
    expect(upstream.has('outer-if')).toBe(true);
    expect(upstream.has('prep')).toBe(true);
  });
});

describe('computeTransitiveDownstream', () => {
  it('collects forward chain', () => {
    const ds = computeTransitiveDownstream('b', linear());
    expect(ds.sort()).toEqual(['c', 'd']);
  });

  it('container downstream includes body subtree as a unit + siblings after', () => {
    const ds = computeTransitiveDownstream('outer-if', dslWithNestedWhile());
    expect(ds).toEqual(expect.arrayContaining(['loop', 'inner', 'end']));
  });

  it('if-else body steps appear as downstream when container is the anchor', () => {
    const ds = computeTransitiveDownstream('gate', dslWithIfElse());
    expect(ds).toEqual(expect.arrayContaining(['work-a', 'work-b', 'fallback', 'finish']));
  });
});

describe('buildDebugRuntimeContext', () => {
  const dsl = linear();

  it('run-to: skipSet = everything outside upstream ∪ {target}', () => {
    const ctx = buildDebugRuntimeContext({
      sessionId: 's', mode: 'run-to', targetStepId: 'c',
      dsl, cachedSteps: [],
    });
    expect(ctx.skipSet.has('a')).toBe(false);
    expect(ctx.skipSet.has('b')).toBe(false);
    expect(ctx.skipSet.has('c')).toBe(false);
    expect(ctx.skipSet.has('d')).toBe(true);
  });

  it('rerun-only: same skip semantics as run-to', () => {
    const ctx = buildDebugRuntimeContext({
      sessionId: 's', mode: 'rerun-only', targetStepId: 'c',
      dsl, cachedSteps: [],
    });
    expect(ctx.skipSet.has('a')).toBe(false);
    expect(ctx.skipSet.has('d')).toBe(true);
  });

  it('continue-from: skips target + all upstream, requires cache for target', () => {
    const hashes = buildConfigHashes(dsl);
    const cached = [stubCache('c', hashes.get('c')!)];
    const ctx = buildDebugRuntimeContext({
      sessionId: 's', mode: 'continue-from', targetStepId: 'c',
      dsl, cachedSteps: cached,
    });
    expect(ctx.skipSet.has('a')).toBe(true);
    expect(ctx.skipSet.has('b')).toBe(true);
    expect(ctx.skipSet.has('c')).toBe(true);
    expect(ctx.skipSet.has('d')).toBe(false);
  });

  it('continue-from without cache for target throws', () => {
    expect(() => buildDebugRuntimeContext({
      sessionId: 's', mode: 'continue-from', targetStepId: 'c',
      dsl, cachedSteps: [],
    })).toThrow(/continue-from/);
  });

  it('configHashes map has one entry per node', () => {
    const ctx = buildDebugRuntimeContext({
      sessionId: 's', mode: 'run-to', targetStepId: 'c',
      dsl, cachedSteps: [],
    });
    expect(ctx.configHashes.size).toBe(dsl.nodes.length);
  });

  it('container scenario: run-to on a step inside if-else includes the container + prior sibling', () => {
    const d = dslWithIfElse();
    const ctx = buildDebugRuntimeContext({
      sessionId: 's', mode: 'run-to', targetStepId: 'work-b',
      dsl: d, cachedSteps: [],
    });
    expect(ctx.skipSet.has('work-a')).toBe(false);
    expect(ctx.skipSet.has('gate')).toBe(false);
    expect(ctx.skipSet.has('setup')).toBe(false);
    expect(ctx.skipSet.has('fallback')).toBe(true);
    expect(ctx.skipSet.has('finish')).toBe(true);
  });

  it('production resume keeps skipSet empty and disables debug persistence', () => {
    const hashes = buildConfigHashes(dsl);
    const ctx = buildResumeRuntimeContext({
      sessionId: 'resume-run',
      targetStepId: 'c',
      dsl,
      cachedSteps: [
        stubCache('a', hashes.get('a')!),
        stubCache('b', hashes.get('b')!),
      ],
    });

    expect(ctx.skipSet.size).toBe(0);
    expect(ctx.cache.has('a')).toBe(true);
    expect(ctx.cache.has('b')).toBe(true);
    expect(ctx.cache.has('c')).toBe(false);
    expect(ctx.persist).toBe(false);
  });
});
