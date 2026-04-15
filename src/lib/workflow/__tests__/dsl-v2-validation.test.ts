import { validateWorkflowDslV2 } from '../dsl';
import type { WorkflowDSLV2 } from '../types';

function makeDsl(steps: WorkflowDSLV2['steps']): WorkflowDSLV2 {
  return { version: 'v2', name: 'test', steps };
}

describe('validateWorkflowDslV2 — body step dependency rules', () => {
  test('allows dependsOn between sibling body steps in the same while', () => {
    const result = validateWorkflowDslV2(makeDsl([
      { id: 'w', type: 'while', input: { condition: { op: 'lt', left: 'input.i', right: 3 }, body: ['a', 'b'], maxIterations: 5 } },
      { id: 'a', type: 'agent', input: { prompt: 'step A' } },
      { id: 'b', type: 'agent', dependsOn: ['a'], input: { prompt: 'step B' } },
    ]));
    expect(result.valid).toBe(true);
  });

  test('blocks dependsOn from top-level step to owned body step', () => {
    const result = validateWorkflowDslV2(makeDsl([
      { id: 'w', type: 'while', input: { condition: { op: 'lt', left: 'input.i', right: 3 }, body: ['a'], maxIterations: 5 } },
      { id: 'a', type: 'agent', input: { prompt: 'body step' } },
      { id: 'top', type: 'agent', dependsOn: ['a'], input: { prompt: 'top level' } },
    ]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('owned by a control flow step'))).toBe(true);
  });

  test('body step can reference prior sibling output without explicit dependsOn', () => {
    const result = validateWorkflowDslV2(makeDsl([
      { id: 'w', type: 'for-each', input: { collection: 'input.items', itemVar: 'item', body: ['a', 'b'], maxIterations: 10 } },
      { id: 'a', type: 'agent', input: { prompt: 'first' } },
      { id: 'b', type: 'agent', input: { prompt: 'use {{steps.a.output.summary}}', context: { prev: 'steps.a.output.summary' } } },
    ]));
    expect(result.valid).toBe(true);
  });

  test('body step cannot reference later sibling output (not yet executed)', () => {
    const result = validateWorkflowDslV2(makeDsl([
      { id: 'w', type: 'for-each', input: { collection: 'input.items', itemVar: 'item', body: ['a', 'b'], maxIterations: 10 } },
      { id: 'a', type: 'agent', input: { prompt: 'use later', context: { next: 'steps.b.output.summary' } } },
      { id: 'b', type: 'agent', input: { prompt: 'second' } },
    ]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('without declaring dependency'))).toBe(true);
  });

  test('while step condition can reference its own body step output', () => {
    const result = validateWorkflowDslV2(makeDsl([
      {
        id: 'w', type: 'while',
        input: {
          condition: { op: 'eq', left: 'steps.check.output.done', right: true },
          body: ['check'],
          maxIterations: 10,
        },
      },
      { id: 'check', type: 'agent', input: { prompt: 'check status' } },
    ]));
    expect(result.valid).toBe(true);
  });

  test('body step can reference loop-external step via inherited parent deps', () => {
    // init-queue → loop(while, dependsOn: init-queue) → body step references init-queue.output
    const result = validateWorkflowDslV2(makeDsl([
      { id: 'init', type: 'agent', input: { prompt: 'init' } },
      {
        id: 'loop', type: 'while',
        dependsOn: ['init'],
        input: {
          condition: { op: 'eq', left: 'steps.check.output.has_pending', right: true },
          body: ['check', 'process'],
          maxIterations: 10,
          mode: 'do-while',
        },
      },
      { id: 'check', type: 'agent', input: { prompt: 'check' } },
      { id: 'process', type: 'agent', input: { prompt: 'use init output', context: { dir: 'steps.init.output.runDir' } } },
    ]));
    expect(result.valid).toBe(true);
  });

  test('if-else step condition can reference body step from then branch', () => {
    const result = validateWorkflowDslV2(makeDsl([
      { id: 'prep', type: 'agent', input: { prompt: 'prepare' } },
      {
        id: 'branch', type: 'if-else',
        dependsOn: ['prep'],
        input: {
          condition: { op: 'eq', left: 'steps.prep.output.ready', right: true },
          then: ['t1'],
        },
      },
      { id: 't1', type: 'agent', input: { prompt: 'then branch' } },
    ]));
    expect(result.valid).toBe(true);
  });

  test('while with do-while mode passes validation', () => {
    const result = validateWorkflowDslV2(makeDsl([
      {
        id: 'w', type: 'while',
        input: {
          condition: { op: 'eq', left: 'steps.check.output.has_pending', right: true },
          body: ['check'],
          maxIterations: 10,
          mode: 'do-while',
        },
      },
      { id: 'check', type: 'agent', input: { prompt: 'check queue' } },
    ]));
    expect(result.valid).toBe(true);
  });

  test('then-branch step cannot implicitly reference else-branch step', () => {
    const result = validateWorkflowDslV2(makeDsl([
      {
        id: 'branch', type: 'if-else',
        input: {
          condition: { op: 'eq', left: 'input.flag', right: true },
          then: ['t1'],
          else: ['e1'],
        },
      },
      { id: 't1', type: 'agent', input: { prompt: 'ref else', context: { x: 'steps.e1.output.summary' } } },
      { id: 'e1', type: 'agent', input: { prompt: 'else step' } },
    ]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('without declaring dependency'))).toBe(true);
  });
});

describe('validateWorkflowDslV2 — loop state', () => {
  test('do-while body step can read state.xxx without dependsOn (feedback loop)', () => {
    const result = validateWorkflowDslV2(makeDsl([
      {
        id: 'refine-loop', type: 'while',
        input: {
          mode: 'do-while',
          condition: { op: 'lt', left: 'state.lastQC.score', right: 0.9 },
          body: ['do-cutout', 'cutout-qc'],
          maxIterations: 5,
          state: {
            initial: { lastQC: null },
            update: { lastQC: 'steps.cutout-qc.output' },
          },
        },
      },
      { id: 'do-cutout', type: 'agent', input: { prompt: 'cutout', context: { previousQC: 'state.lastQC' } } },
      { id: 'cutout-qc', type: 'agent', dependsOn: ['do-cutout'], input: { prompt: 'qc', context: { image: 'steps.do-cutout.output.image' } } },
    ]));
    expect(result.valid).toBe(true);
  });

  test('state reference outside a while loop is rejected', () => {
    const result = validateWorkflowDslV2(makeDsl([
      { id: 'a', type: 'agent', input: { prompt: 'read state', context: { s: 'state.foo' } } },
    ]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('not inside a while/do-while loop'))).toBe(true);
  });

  test('state reference inside for-each (but no while ancestor) is rejected', () => {
    const result = validateWorkflowDslV2(makeDsl([
      {
        id: 'loop', type: 'for-each',
        input: { collection: 'input.items', itemVar: 'item', body: ['a'] },
      },
      { id: 'a', type: 'agent', input: { prompt: 'read state', context: { s: 'state.foo' } } },
    ]));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('not inside a while/do-while loop'))).toBe(true);
  });

  test('while without state still validates (state ref from body fails cleanly if used)', () => {
    const result = validateWorkflowDslV2(makeDsl([
      {
        id: 'w', type: 'while',
        input: {
          condition: { op: 'lt', left: 'input.i', right: 3 },
          body: ['a'],
          maxIterations: 5,
        },
      },
      { id: 'a', type: 'agent', input: { prompt: 'step A' } },
    ]));
    expect(result.valid).toBe(true);
  });

  test('while condition can reference state', () => {
    const result = validateWorkflowDslV2(makeDsl([
      {
        id: 'w', type: 'while',
        input: {
          condition: { op: 'lt', left: 'state.score', right: 0.9 },
          body: ['a'],
          maxIterations: 5,
          state: { initial: { score: 0 }, update: { score: 'steps.a.output.score' } },
        },
      },
      { id: 'a', type: 'agent', input: { prompt: 'score' } },
    ]));
    expect(result.valid).toBe(true);
  });

  test('state.initial must be an object', () => {
    const result = validateWorkflowDslV2(makeDsl([
      {
        id: 'w', type: 'while',
        input: {
          condition: { op: 'lt', left: 'input.i', right: 3 },
          body: ['a'],
          maxIterations: 5,
          // @ts-expect-error invalid shape (testing runtime validation)
          state: { initial: 'not-an-object' },
        },
      },
      { id: 'a', type: 'agent', input: { prompt: 'a' } },
    ]));
    expect(result.valid).toBe(false);
  });

  test('nested while: inner body sees inner state, outer body sees outer state', () => {
    const result = validateWorkflowDslV2(makeDsl([
      {
        id: 'outer', type: 'while',
        input: {
          mode: 'do-while',
          condition: { op: 'lt', left: 'state.outerCount', right: 3 },
          body: ['outer-step', 'inner'],
          state: { initial: { outerCount: 0 } },
        },
      },
      { id: 'outer-step', type: 'agent', input: { prompt: 'outer', context: { c: 'state.outerCount' } } },
      {
        id: 'inner', type: 'while',
        dependsOn: ['outer-step'],
        input: {
          mode: 'do-while',
          condition: { op: 'lt', left: 'state.innerCount', right: 2 },
          body: ['inner-step'],
          state: { initial: { innerCount: 0 } },
        },
      },
      { id: 'inner-step', type: 'agent', input: { prompt: 'inner', context: { c: 'state.innerCount' } } },
    ]));
    expect(result.valid).toBe(true);
  });
});
