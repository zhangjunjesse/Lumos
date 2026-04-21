import { compileWorkflowDslV3 } from '../compiler-v3';
import { validateCompiledWorkflowCode } from '../compiler-helpers';

describe('compileWorkflowDslV3', () => {
  test('fails gracefully on invalid schema', () => {
    const r = compileWorkflowDslV3({ version: 'v2', name: 'bad', nodes: [], edges: [] });
    expect(r.validation.valid).toBe(false);
    expect(r.validation.errors.length).toBeGreaterThan(0);
    expect(r.code).toBe('');
  });

  test('fails gracefully on structural error (unreachable node)', () => {
    const spec = {
      version: 'v3', name: 'bad',
      nodes: [
        { id: 'a', type: 'agent', input: { prompt: 'hi' } },
        { id: 'b', type: 'agent', input: { prompt: 'hi' } },
      ],
      edges: [],
    };
    const r = compileWorkflowDslV3(spec);
    expect(r.validation.valid).toBe(false);
  });

  test('compiles minimal agent→agent flow; code is valid TS', () => {
    const spec = {
      version: 'v3', name: 'hello',
      nodes: [
        { id: 'a', type: 'agent', input: { prompt: 'hello' } },
        { id: 'b', type: 'agent', input: { prompt: '{{ steps.a.output.text }}' } },
      ],
      edges: [{ from: 'a', to: 'b', kind: 'next' }],
    };
    const r = compileWorkflowDslV3(spec);
    expect(r.validation.valid).toBe(true);
    expect(r.code).toContain('export function buildWorkflow');
    expect(r.code).toContain('stepOutputs["a"]');
    expect(r.code).toContain('stepOutputs["b"]');
    const diagnostics = validateCompiledWorkflowCode(r.code);
    expect(diagnostics).toEqual([]);
  });

  test('manifest reflects v3 dslVersion and node types including parallel/join/approval', () => {
    const spec = {
      version: 'v3', name: 'complex',
      nodes: [
        { id: 'p', type: 'parallel', input: {} },
        { id: 'b1', type: 'agent', input: { prompt: 'hi' } },
        { id: 'b2', type: 'agent', input: { prompt: 'hi' } },
        { id: 'j', type: 'join', input: {} },
        {
          id: 'ap', type: 'approval',
          input: { prompt: 'please', approvers: { mode: 'any', users: ['u1'] } },
        },
      ],
      edges: [
        { from: 'p', to: 'b1', kind: 'next', branchIndex: 0 },
        { from: 'p', to: 'b2', kind: 'next', branchIndex: 1 },
        { from: 'b1', to: 'j', kind: 'next' },
        { from: 'b2', to: 'j', kind: 'next' },
        { from: 'j', to: 'ap', kind: 'next' },
      ],
    };
    const r = compileWorkflowDslV3(spec);
    expect(r.validation.valid).toBe(true);
    expect(r.manifest.dslVersion).toBe('v3');
    expect(r.manifest.stepIds).toEqual(['p', 'b1', 'b2', 'j', 'ap']);
    expect(r.manifest.stepTypes).toEqual(['parallel', 'agent', 'agent', 'join', 'approval']);
  });

  test('compiled code includes approvalStep runtime default fallback', () => {
    const spec = {
      version: 'v3', name: 'approval only',
      nodes: [
        {
          id: 'ap', type: 'approval',
          input: { prompt: 'ok', approvers: { mode: 'any', users: ['u1'] } },
        },
      ],
      edges: [],
    };
    const r = compileWorkflowDslV3(spec);
    expect(r.validation.valid).toBe(true);
    expect(r.code).toContain('approvalStep = async () => (');
    expect(r.code).toContain('auto-approved');
  });

  test('workflow version is a deterministic sha-prefixed dsl-v3 hash', () => {
    const spec = {
      version: 'v3', name: 't',
      nodes: [{ id: 'a', type: 'agent', input: { prompt: 'hi' } }],
      edges: [],
    };
    const r1 = compileWorkflowDslV3(spec);
    const r2 = compileWorkflowDslV3(spec);
    expect(r1.manifest.workflowVersion).toMatch(/^dsl-v3-[a-f0-9]{12}$/);
    expect(r1.manifest.workflowVersion).toBe(r2.manifest.workflowVersion);
  });

  test('undeclared contract field rejects compile with E_CONTRACT_FIELD_UNDECLARED', () => {
    const spec = {
      version: 'v3', name: 't',
      nodes: [
        {
          id: 'a', type: 'agent', input: { prompt: 'hi' },
          outputContract: { type: 'object', properties: { text: { type: 'string' } } },
        },
        { id: 'b', type: 'agent', input: { prompt: '{{ steps.a.output.missing }}' } },
      ],
      edges: [{ from: 'a', to: 'b', kind: 'next' }],
    };
    const r = compileWorkflowDslV3(spec);
    expect(r.validation.valid).toBe(false);
    expect(r.validation.errors.some((e) => e.includes('E_CONTRACT_FIELD_UNDECLARED'))).toBe(true);
  });
});
