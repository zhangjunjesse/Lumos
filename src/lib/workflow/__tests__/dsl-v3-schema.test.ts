import { validateWorkflowDslV3 } from '../dsl-v3-schema';

const minimalAgentNode = (id: string) => ({
  id,
  type: 'agent' as const,
  input: { prompt: 'hello' },
});

describe('workflowDslV3Schema', () => {
  test('accepts a minimal two-node agent→next flow', () => {
    const spec = {
      version: 'v3',
      name: 'hello',
      nodes: [minimalAgentNode('a'), minimalAgentNode('b')],
      edges: [{ from: 'a', to: 'b', kind: 'next' }],
    };
    const r = validateWorkflowDslV3(spec);
    expect(r.valid).toBe(true);
  });

  test('accepts if-else / for-each / while / parallel / join / approval / wait node shapes', () => {
    const spec = {
      version: 'v3',
      name: 'all shapes',
      nodes: [
        { id: 'g', type: 'if-else', input: { condition: { op: 'exists', ref: 'input.x' } } },
        { id: 'l', type: 'for-each', input: { collection: 'steps.a.output.list', itemVar: 'item' } },
        { id: 'w', type: 'while', input: { condition: { op: 'lt', left: 'state.i', right: 10 } } },
        { id: 'p', type: 'parallel', input: { onBranchFail: 'wait-all' } },
        { id: 'j', type: 'join', input: {} },
        {
          id: 'ap',
          type: 'approval',
          input: {
            prompt: 'please review',
            approvers: { mode: 'any', users: ['user1'] },
            timeout: { duration: 'PT1H', onTimeout: 'reject' },
          },
        },
        { id: 'wa', type: 'wait', input: { durationMs: 1000 } },
        minimalAgentNode('end'),
      ],
      edges: [
        { from: 'g', to: 'l', kind: 'then' },
        { from: 'g', to: 'w', kind: 'else' },
        { from: 'p', to: 'j', kind: 'next', branchIndex: 0 },
        { from: 'ap', to: 'end', kind: 'next' },
      ],
    };
    expect(validateWorkflowDslV3(spec).valid).toBe(true);
  });

  test("rejects onError.action='goto' without target", () => {
    const spec = {
      version: 'v3',
      name: 'bad onError',
      nodes: [
        { ...minimalAgentNode('a'), onError: { action: 'goto' } },
      ],
      edges: [],
    };
    const r = validateWorkflowDslV3(spec);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('target'))).toBe(true);
  });

  test('rejects self-loop edge', () => {
    const spec = {
      version: 'v3',
      name: 'self loop',
      nodes: [minimalAgentNode('a')],
      edges: [{ from: 'a', to: 'a', kind: 'next' }],
    };
    const r = validateWorkflowDslV3(spec);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('self-loop'))).toBe(true);
  });

  test('rejects unknown edge kind', () => {
    const spec = {
      version: 'v3',
      name: 'bad kind',
      nodes: [minimalAgentNode('a'), minimalAgentNode('b')],
      edges: [{ from: 'a', to: 'b', kind: 'ref' }],
    };
    expect(validateWorkflowDslV3(spec).valid).toBe(false);
  });

  test('rejects invalid step id', () => {
    const spec = {
      version: 'v3',
      name: 'bad id',
      nodes: [{ id: '123-bad', type: 'agent', input: {} }],
      edges: [],
    };
    expect(validateWorkflowDslV3(spec).valid).toBe(false);
  });

  test("rejects approval quorum mode without quorum field", () => {
    const spec = {
      version: 'v3',
      name: 'bad quorum',
      nodes: [{
        id: 'ap',
        type: 'approval',
        input: {
          prompt: 'r',
          approvers: { mode: 'quorum', users: ['u1', 'u2'] },
        },
      }],
      edges: [],
    };
    expect(validateWorkflowDslV3(spec).valid).toBe(false);
  });

  test('rejects DSL without version=v3', () => {
    const spec = {
      version: 'v2',
      name: 'wrong version',
      nodes: [minimalAgentNode('a')],
      edges: [],
    };
    expect(validateWorkflowDslV3(spec).valid).toBe(false);
  });

  test('rejects exceeding WORKFLOW_MAX_NODES (100)', () => {
    const nodes = Array.from({ length: 101 }, (_, i) => minimalAgentNode(`n${i}`));
    const spec = { version: 'v3', name: 'too many', nodes, edges: [] };
    expect(validateWorkflowDslV3(spec).valid).toBe(false);
  });
});
