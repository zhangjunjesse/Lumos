import {
  buildConfigHashes,
  buildDebugRuntimeContext,
  computeConfigHash,
  computeTransitiveDownstream,
  computeUpstreamClosure,
} from '../debug-cache';
import type { AnyWorkflowDSL, WorkflowStep } from '../types';
import type { DebugStepOutput } from '../debug-types';

const agent = (id: string, extras: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id,
  type: 'agent',
  input: { prompt: `p-${id}` },
  ...extras,
});

const container = (id: string, type: 'if-else' | 'while' | 'for-each', input: Record<string, unknown>): WorkflowStep => ({
  id, type, input,
});

function linear(): AnyWorkflowDSL {
  return {
    version: 'v2', name: 'linear',
    steps: [
      agent('a'),
      agent('b', { dependsOn: ['a'] }),
      agent('c', { dependsOn: ['b'] }),
      agent('d', { dependsOn: ['c'] }),
    ],
  };
}

function dslWithIfElse(): AnyWorkflowDSL {
  return {
    version: 'v2', name: 'if-else nested',
    steps: [
      agent('setup'),
      container('gate', 'if-else', {
        condition: { op: 'exists', ref: 'input.flag' },
        then: ['work-a', 'work-b'],
        else: ['fallback'],
      }),
      agent('work-a'),
      agent('work-b'),
      agent('fallback'),
      agent('finish', { dependsOn: ['gate'] }),
    ],
  };
}

function dslWithNestedWhile(): AnyWorkflowDSL {
  return {
    version: 'v2', name: 'nested',
    steps: [
      agent('prep'),
      container('outer-if', 'if-else', {
        condition: { op: 'exists', ref: 'input.go' },
        then: ['loop'],
      }),
      container('loop', 'while', {
        condition: { op: 'exists', ref: 'state.x' },
        body: ['inner'],
      }),
      agent('inner'),
      agent('end', { dependsOn: ['outer-if'] }),
    ],
  };
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

describe('computeConfigHash', () => {
  it('returns the same hash for identical (input/when/policy) config', () => {
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
  it('collects transitive dependsOn chain in a linear DSL', () => {
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
    // work-a is a prior sibling in `then`; `gate` is the enclosing container; `setup` is its dep-free prior sibling.
    expect(upstream.has('work-a')).toBe(true);
    expect(upstream.has('gate')).toBe(true);
    // setup is a top-level prior sibling of gate
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
  it('collects dependsOn descendants + later siblings', () => {
    const ds = computeTransitiveDownstream('b', linear());
    expect(ds.sort()).toEqual(['c', 'd']);
  });

  it('container downstream includes body subtree as a unit + siblings after', () => {
    const ds = computeTransitiveDownstream('outer-if', dslWithNestedWhile());
    // body subtree of outer-if is [loop], and loop's body is [inner]
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

  it('configHashes map has one entry per step', () => {
    const ctx = buildDebugRuntimeContext({
      sessionId: 's', mode: 'run-to', targetStepId: 'c',
      dsl, cachedSteps: [],
    });
    expect(ctx.configHashes.size).toBe(dsl.steps.length);
  });

  it('container scenario: run-to on a step inside if-else includes the container + prior sibling', () => {
    const d = dslWithIfElse();
    const ctx = buildDebugRuntimeContext({
      sessionId: 's', mode: 'run-to', targetStepId: 'work-b',
      dsl: d, cachedSteps: [],
    });
    expect(ctx.skipSet.has('work-a')).toBe(false); // upstream (prior sibling)
    expect(ctx.skipSet.has('gate')).toBe(false); // upstream (parent container)
    expect(ctx.skipSet.has('setup')).toBe(false); // upstream
    expect(ctx.skipSet.has('fallback')).toBe(true); // unrelated branch
    expect(ctx.skipSet.has('finish')).toBe(true); // downstream
  });
});
