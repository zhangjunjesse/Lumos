import { emitRuntimeHelpers } from '../compiler-helpers';

function buildHelpers(): {
  __resolveRef: (r: string, i: unknown, s: Record<string, unknown>, st: unknown) => unknown;
  __resolveValue: (v: unknown, i: unknown, s: Record<string, unknown>, st: unknown) => unknown;
  __formatForTemplate: (v: unknown) => string;
  __RefResolutionError: new (ref: string, reason: string) => Error;
} {
  const src = emitRuntimeHelpers().join('\n');
  const factory = new Function(
    `${src}\nreturn { __resolveRef, __resolveValue, __formatForTemplate, __RefResolutionError };`,
  );
  return factory() as ReturnType<typeof buildHelpers>;
}

describe('compiled runtime helpers', () => {
  const { __resolveRef, __resolveValue, __formatForTemplate } = buildHelpers();

  const input = { user: { name: 'Alice', tags: ['a', 'b'] }, num: 42 };
  const stepOutputs = {
    planner: { output: { title: 'hello', items: [1, 2], nested: { deep: 'value' } } },
    broken: { output: null },
  };
  const state = { counter: 3 };

  test('resolves plain ref: input, input.x, state.x', () => {
    expect(__resolveRef('input', input, stepOutputs, state)).toEqual(input);
    expect(__resolveRef('input.user.name', input, stepOutputs, state)).toBe('Alice');
    expect(__resolveRef('state.counter', input, stepOutputs, state)).toBe(3);
  });

  test('resolves steps.x.output.y with dotted path', () => {
    expect(__resolveRef('steps.planner.output.title', input, stepOutputs, state)).toBe('hello');
    expect(__resolveRef('steps.planner.output.nested.deep', input, stepOutputs, state)).toBe('value');
  });

  test('supports optional chain ?. to avoid crashing on missing intermediates', () => {
    expect(__resolveRef('steps.missing?.output.title', input, stepOutputs, state)).toBeUndefined();
    expect(__resolveRef('steps.broken.output?.title', input, stepOutputs, state)).toBeUndefined();
    expect(__resolveRef('input.user?.notAField', input, stepOutputs, state)).toBeUndefined();
  });

  test('supports ?? default fallback for undefined/null', () => {
    expect(__resolveRef("steps.missing?.output.title ?? 'fallback'", input, stepOutputs, state)).toBe('fallback');
    expect(__resolveRef('input.missing ?? 99', input, stepOutputs, state)).toBe(99);
    // Present value ignores default
    expect(__resolveRef("input.user.name ?? 'x'", input, stepOutputs, state)).toBe('Alice');
  });

  test('template {{}} auto-stringifies objects to JSON (not [object Object])', () => {
    const out = __resolveValue(
      'user={{ input.user }}',
      input, stepOutputs, state,
    );
    expect(out).toContain('"name":"Alice"');
    expect(out).not.toContain('[object Object]');
  });

  test('template {{}} converts arrays to JSON array syntax', () => {
    const out = __resolveValue(
      'items={{ steps.planner.output.items }}',
      input, stepOutputs, state,
    );
    expect(out).toBe('items=[1,2]');
  });

  test('template {{}} renders undefined as empty string', () => {
    const out = __resolveValue(
      'x={{ input.missing }}!',
      input, stepOutputs, state,
    );
    expect(out).toBe('x=!');
  });

  test('template + ?? default in one', () => {
    const out = __resolveValue(
      "name={{ input.missing ?? 'anon' }}",
      input, stepOutputs, state,
    );
    expect(out).toBe('name=anon');
  });

  test('__formatForTemplate edge cases', () => {
    expect(__formatForTemplate(undefined)).toBe('');
    expect(__formatForTemplate(null)).toBe('');
    expect(__formatForTemplate(42)).toBe('42');
    expect(__formatForTemplate(true)).toBe('true');
    expect(__formatForTemplate({ a: 1 })).toBe('{"a":1}');
    expect(__formatForTemplate([1, 2])).toBe('[1,2]');
  });

  test('RefResolutionError thrown only for truly unsupported syntax', () => {
    expect(() => __resolveRef('garbage.expression', input, stepOutputs, state)).toThrow(/unsupported/);
    // Missing step is silent (undefined), not an error — callers can use ??
    expect(__resolveRef('steps.missing.output.x', input, stepOutputs, state)).toBeUndefined();
  });
});
