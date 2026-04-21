import { validateDsl } from '../validate-dsl-v3';

describe('validateDsl (unified facade)', () => {
  test('short-circuits on schema error (does not run structural)', () => {
    const spec = { version: 'v2', name: 'wrong', nodes: [], edges: [] };
    const r = validateDsl(spec);
    expect(r.valid).toBe(false);
    expect(r.schemaErrors.length).toBeGreaterThan(0);
    // schema issues should dominate, no structural codes leaked
    expect(r.issues.every((i) => i.code === 'E_SCHEMA')).toBe(true);
  });

  test('runs structural rules when schema passes', () => {
    const spec = {
      version: 'v3',
      name: 'bad-structure',
      nodes: [
        { id: 'a', type: 'agent', input: { prompt: '{{ steps.ghost.output.x }}' } },
      ],
      edges: [],
    };
    const r = validateDsl(spec);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'E_UNKNOWN_REF')).toBe(true);
    expect(r.schemaErrors).toHaveLength(0);
  });

  test('passes on a clean minimal agent→agent flow', () => {
    const spec = {
      version: 'v3',
      name: 'ok',
      nodes: [
        { id: 'a', type: 'agent', input: { prompt: 'hi' } },
        { id: 'b', type: 'agent', input: { prompt: '{{ steps.a.output.text }}' } },
      ],
      edges: [{ from: 'a', to: 'b', kind: 'next' }],
    };
    const r = validateDsl(spec);
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  test('E_CONTRACT_FIELD_UNDECLARED rejects DSL when reference field is not in outputContract', () => {
    const spec = {
      version: 'v3',
      name: 'contract check',
      nodes: [
        {
          id: 'a',
          type: 'agent',
          input: { prompt: 'hi' },
          outputContract: { type: 'object', properties: { text: { type: 'string' } } },
        },
        {
          id: 'b',
          type: 'agent',
          input: { prompt: '{{ steps.a.output.missing }}' },
        },
      ],
      edges: [{ from: 'a', to: 'b', kind: 'next' }],
    };
    const r = validateDsl(spec);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'E_CONTRACT_FIELD_UNDECLARED')).toBe(true);
  });

  test('accepts contract-declared reference', () => {
    const spec = {
      version: 'v3',
      name: 'contract ok',
      nodes: [
        {
          id: 'a',
          type: 'agent',
          input: { prompt: 'hi' },
          outputContract: { type: 'object', properties: { text: { type: 'string' } } },
        },
        {
          id: 'b',
          type: 'agent',
          input: { prompt: '{{ steps.a.output.text }}' },
        },
      ],
      edges: [{ from: 'a', to: 'b', kind: 'next' }],
    };
    const r = validateDsl(spec);
    expect(r.valid).toBe(true);
    expect(r.issues.some((i) => i.code === 'E_CONTRACT_FIELD_UNDECLARED')).toBe(false);
  });

  test('skips contract check when outputContract is absent', () => {
    const spec = {
      version: 'v3',
      name: 'no contract',
      nodes: [
        { id: 'a', type: 'agent', input: { prompt: 'hi' } },
        { id: 'b', type: 'agent', input: { prompt: '{{ steps.a.output.anything }}' } },
      ],
      edges: [{ from: 'a', to: 'b', kind: 'next' }],
    };
    const r = validateDsl(spec);
    expect(r.valid).toBe(true);
    expect(r.issues.some((i) => i.code === 'E_CONTRACT_FIELD_UNDECLARED')).toBe(false);
  });

  test('optional-chain syntax is still checked against contract', () => {
    const spec = {
      version: 'v3',
      name: 'contract optional',
      nodes: [
        {
          id: 'a', type: 'agent', input: { prompt: 'hi' },
          outputContract: { type: 'object', properties: { text: { type: 'string' } } },
        },
        { id: 'b', type: 'agent', input: { prompt: '{{ steps.a.output?.missing }}' } },
      ],
      edges: [{ from: 'a', to: 'b', kind: 'next' }],
    };
    const r = validateDsl(spec);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === 'E_CONTRACT_FIELD_UNDECLARED')).toBe(true);
  });
});
