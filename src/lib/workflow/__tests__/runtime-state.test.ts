import { emitRuntimeHelpers } from '../compiler-helpers';

type Resolver = (value: unknown, input: unknown, stepOutputs: unknown, state?: unknown) => unknown;
type ConditionEvaluator = (cond: unknown, input: unknown, stepOutputs: unknown, state?: unknown) => boolean;
type StateMerger = (prev: unknown, partial: unknown) => unknown;

function loadHelpers() {
  const lines = emitRuntimeHelpers().join('\n');
  const factory = new Function(`
    ${lines}
    return { __resolveRef, __resolveValue, __evaluateCondition, __mergeState };
  `);
  return factory() as {
    __resolveRef: Resolver;
    __resolveValue: Resolver;
    __evaluateCondition: ConditionEvaluator;
    __mergeState: StateMerger;
  };
}

describe('runtime helpers — state references', () => {
  const { __resolveRef, __resolveValue, __evaluateCondition, __mergeState } = loadHelpers();

  test('state and state.path refs resolve against the passed-in state object', () => {
    const state = { lastQC: { score: 0.6 }, attempts: 2 };
    expect(__resolveRef('state', {}, {}, state)).toEqual(state);
    expect(__resolveRef('state.lastQC.score', {}, {}, state)).toBe(0.6);
    expect(__resolveRef('state.attempts', {}, {}, state)).toBe(2);
    expect(__resolveRef('state.missing', {}, {}, state)).toBeUndefined();
  });

  test('state ref returns undefined when state is undefined (first iter-style)', () => {
    expect(__resolveRef('state', {}, {}, undefined)).toBeUndefined();
    expect(__resolveRef('state.lastQC', {}, {}, undefined)).toBeUndefined();
  });

  test('__resolveValue walks objects and resolves nested state refs', () => {
    const state = { last: { feedback: 'be shorter' } };
    const input = { topic: 'Go concurrency' };
    const resolved = __resolveValue(
      { prompt: 'topic: {{input.topic}}', prev: 'state.last.feedback', nested: { s: 'state' } },
      input,
      {},
      state,
    );
    expect(resolved).toEqual({
      prompt: 'topic: Go concurrency',
      prev: 'be shorter',
      nested: { s: state },
    });
  });

  test('__evaluateCondition uses state values for lt/gt/eq', () => {
    const state = { score: 0.7 };
    expect(__evaluateCondition({ op: 'lt', left: 'state.score', right: 0.9 }, {}, {}, state)).toBe(true);
    expect(__evaluateCondition({ op: 'gt', left: 'state.score', right: 0.9 }, {}, {}, state)).toBe(false);
    expect(__evaluateCondition({ op: 'eq', left: 'state.score', right: 0.7 }, {}, {}, state)).toBe(true);
  });

  test('__mergeState shallow-merges partial into prev', () => {
    expect(__mergeState({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
    expect(__mergeState(undefined, { a: 1 })).toEqual({ a: 1 });
    expect(__mergeState({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(__mergeState({ a: 1 }, null)).toEqual({ a: 1 });
  });

  test('state ref falls back cleanly when path hits undefined mid-chain', () => {
    const state = { a: null };
    expect(__resolveRef('state.a.b.c', {}, {}, state)).toBeUndefined();
  });
});
