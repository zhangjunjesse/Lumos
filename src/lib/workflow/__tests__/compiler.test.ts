import { generateWorkflowFromDsl } from '../compiler';
import type { AnyWorkflowDSL } from '../types';

describe('generateWorkflowFromDsl', () => {
  // Regression for #15: a stale v1 spec carries `steps`, not `nodes`. The
  // invalid-spec path still builds a manifest, which used to do
  // `spec.nodes.map(...)` unconditionally and throw "Cannot read properties of
  // undefined (reading 'map')" — masking the real validation error.
  test('does not throw on a v1 spec (steps, no nodes); returns a clean validation error', () => {
    const v1Spec = {
      version: 'v1',
      name: 'test',
      steps: [{ id: 's1', type: 'agent' }],
    } as unknown as AnyWorkflowDSL;

    expect(() => generateWorkflowFromDsl(v1Spec)).not.toThrow();

    const r = generateWorkflowFromDsl(v1Spec);
    expect(r.validation.valid).toBe(false);
    expect(r.validation.errors.join(' ')).toMatch(/unsupported DSL version/i);
    expect(r.code).toBe('');
    expect(r.manifest.stepIds).toEqual([]);
  });

  test('does not throw when nodes is entirely absent', () => {
    const spec = { version: 'v1', name: 'empty' } as unknown as AnyWorkflowDSL;
    expect(() => generateWorkflowFromDsl(spec)).not.toThrow();
    expect(generateWorkflowFromDsl(spec).validation.valid).toBe(false);
  });

  test('compiles a valid v3 graph into a factory module', () => {
    const spec = {
      version: 'v3',
      name: 'hello',
      nodes: [
        { id: 'a', type: 'agent', input: { prompt: 'hello' } },
        { id: 'b', type: 'agent', input: { prompt: '{{ steps.a.output.text }}' } },
      ],
      edges: [{ from: 'a', to: 'b', kind: 'next' }],
    } as unknown as AnyWorkflowDSL;

    const r = generateWorkflowFromDsl(spec);
    expect(r.validation.valid).toBe(true);
    expect(r.code).toContain('export function buildWorkflow');
    expect(r.manifest.stepIds).toEqual(['a', 'b']);
  });
});
