import { validateDslStructure } from '../dsl-validator';
import type { WorkflowDSLV3, WorkflowNode, WorkflowEdge } from '../types-v3';

const mk = (overrides: Partial<WorkflowDSLV3> = {}): WorkflowDSLV3 => ({
  version: 'v3',
  name: 't',
  nodes: [],
  edges: [],
  ...overrides,
});

const agent = (id: string, input: Record<string, unknown> = { prompt: 'hi' }): WorkflowNode =>
  ({ id, type: 'agent', input }) as WorkflowNode;

const edge = (from: string, to: string, kind: WorkflowEdge['kind'], branchIndex?: number): WorkflowEdge =>
  branchIndex === undefined ? { from, to, kind } : { from, to, kind, branchIndex };

const hasCode = (r: ReturnType<typeof validateDslStructure>, code: string): boolean =>
  r.issues.some((i) => i.code === code);

describe('validateDslStructure', () => {
  // ── sanity ────────────────────────────────────────────────────────────────
  test('accepts a minimal agent→agent next flow', () => {
    const dsl = mk({ nodes: [agent('a'), agent('b')], edges: [edge('a', 'b', 'next')] });
    const r = validateDslStructure(dsl);
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  // ── 1. duplicate ids ──────────────────────────────────────────────────────
  test('E_DUP_NODE_ID when two nodes share an id', () => {
    const dsl = mk({ nodes: [agent('a'), agent('a')], edges: [] });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_DUP_NODE_ID')).toBe(true);
  });

  // ── 2. edge endpoints exist ───────────────────────────────────────────────
  test('E_UNKNOWN_EDGE_NODE when edge references missing node', () => {
    const dsl = mk({ nodes: [agent('a')], edges: [edge('a', 'ghost', 'next')] });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_UNKNOWN_EDGE_NODE')).toBe(true);
  });

  // ── 3. edge kind per source ───────────────────────────────────────────────
  test('E_EDGE_KIND_UNSUPPORTED when agent uses then/else', () => {
    const dsl = mk({
      nodes: [agent('a'), agent('b')],
      edges: [edge('a', 'b', 'then')],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_EDGE_KIND_UNSUPPORTED')).toBe(true);
  });

  // ── 4. out-degree ─────────────────────────────────────────────────────────
  test('E_OUT_DEGREE_MISMATCH when if-else missing else branch', () => {
    const dsl = mk({
      nodes: [
        { id: 'g', type: 'if-else', input: { condition: { op: 'exists', ref: 'input.x' } } } as WorkflowNode,
        agent('a'),
      ],
      edges: [edge('g', 'a', 'then')],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_OUT_DEGREE_MISMATCH')).toBe(true);
  });

  test('E_OUT_DEGREE_MISMATCH when parallel has only 1 branch', () => {
    const dsl = mk({
      nodes: [
        { id: 'p', type: 'parallel', input: {} } as WorkflowNode,
        { id: 'j', type: 'join', input: {} } as WorkflowNode,
        agent('a'),
      ],
      edges: [edge('p', 'a', 'next', 0), edge('a', 'j', 'next'), edge('j', 'a', 'next')],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_OUT_DEGREE_MISMATCH')).toBe(true);
  });

  // ── 5. on-error consistency ───────────────────────────────────────────────
  test('E_MULTI_ON_ERROR when node has 2 on-error edges', () => {
    const dsl = mk({
      nodes: [agent('a'), agent('b'), agent('c')],
      edges: [
        edge('a', 'b', 'next'),
        edge('a', 'b', 'on-error'),
        edge('a', 'c', 'on-error'),
      ],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_MULTI_ON_ERROR')).toBe(true);
  });

  test('E_ON_ERROR_EDGE_MISSING when onError.goto without edge', () => {
    const dsl = mk({
      nodes: [
        { ...agent('a'), onError: { action: 'goto', target: 'b' } } as WorkflowNode,
        agent('b'),
      ],
      edges: [edge('a', 'b', 'next')],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_ON_ERROR_EDGE_MISSING')).toBe(true);
  });

  test('E_ON_ERROR_TARGET_MISMATCH when edge target ≠ onError.target', () => {
    const dsl = mk({
      nodes: [
        { ...agent('a'), onError: { action: 'goto', target: 'b' } } as WorkflowNode,
        agent('b'),
        agent('c'),
      ],
      edges: [edge('a', 'b', 'next'), edge('a', 'c', 'on-error')],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_ON_ERROR_TARGET_MISMATCH')).toBe(true);
  });

  // ── 6. entry ──────────────────────────────────────────────────────────────
  test('E_MULTI_ENTRY when two nodes have no normal-in edges', () => {
    const dsl = mk({ nodes: [agent('a'), agent('b')], edges: [] });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_MULTI_ENTRY')).toBe(true);
  });

  // ── 7. reachability ───────────────────────────────────────────────────────
  test('E_UNREACHABLE when a node has no path from entry', () => {
    const dsl = mk({
      nodes: [agent('a'), agent('b'), agent('c')],
      edges: [edge('a', 'b', 'next'), edge('c', 'c', 'next')],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_UNREACHABLE')).toBe(true);
  });

  // ── 8. illegal cycle ──────────────────────────────────────────────────────
  test('E_ILLEGAL_CYCLE on next-only cycle', () => {
    const dsl = mk({
      nodes: [agent('a'), agent('b')],
      edges: [edge('a', 'b', 'next'), edge('b', 'a', 'next')],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_ILLEGAL_CYCLE')).toBe(true);
  });

  test('accepts while-body loop (body edge cycle is legal)', () => {
    const dsl = mk({
      nodes: [
        {
          id: 'w',
          type: 'while',
          input: { condition: { op: 'lt', left: 'state.i', right: 10 } },
        } as WorkflowNode,
        agent('body'),
        agent('after'),
      ],
      edges: [
        edge('w', 'body', 'body'),
        edge('body', 'w', 'next'),
        edge('w', 'after', 'next'),
      ],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_ILLEGAL_CYCLE')).toBe(false);
  });

  // ── 9. parallel ↔ join pairing ───────────────────────────────────────────
  test('accepts proper parallel+join flow', () => {
    const dsl = mk({
      nodes: [
        { id: 'p', type: 'parallel', input: {} } as WorkflowNode,
        agent('b1'),
        agent('b2'),
        { id: 'j', type: 'join', input: {} } as WorkflowNode,
        agent('end'),
      ],
      edges: [
        edge('p', 'b1', 'next', 0),
        edge('p', 'b2', 'next', 1),
        edge('b1', 'j', 'next'),
        edge('b2', 'j', 'next'),
        edge('j', 'end', 'next'),
      ],
    });
    const r = validateDslStructure(dsl);
    expect(r.valid).toBe(true);
  });

  test('E_JOIN_IN_MISMATCH when join in-degree ≠ parallel branches', () => {
    // 3 parallel branches but join only receives 2
    const dsl = mk({
      nodes: [
        { id: 'p', type: 'parallel', input: {} } as WorkflowNode,
        agent('b1'),
        agent('b2'),
        agent('b3'),
        { id: 'j', type: 'join', input: {} } as WorkflowNode,
        agent('end'),
      ],
      edges: [
        edge('p', 'b1', 'next', 0),
        edge('p', 'b2', 'next', 1),
        edge('p', 'b3', 'next', 2),
        edge('b1', 'j', 'next'),
        edge('b2', 'j', 'next'),
        edge('b3', 'end', 'next'), // bypasses join
        edge('j', 'end', 'next'),
      ],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_JOIN_IN_MISMATCH')).toBe(true);
  });

  // ── 10. parallel branch limit ────────────────────────────────────────────
  test('E_MAX_PARALLEL_BRANCHES when parallel has >10 branches', () => {
    const branches = Array.from({ length: 11 }, (_, i) => agent(`b${i}`));
    const dsl = mk({
      nodes: [
        { id: 'p', type: 'parallel', input: {} } as WorkflowNode,
        ...branches,
        { id: 'j', type: 'join', input: {} } as WorkflowNode,
        agent('end'),
      ],
      edges: [
        ...branches.map((b, i) => edge('p', b.id, 'next', i)),
        ...branches.map((b) => edge(b.id, 'j', 'next')),
        edge('j', 'end', 'next'),
      ],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_MAX_PARALLEL_BRANCHES')).toBe(true);
  });

  // ── 11. references topological predecessor ───────────────────────────────
  test('accepts reference to a topological predecessor', () => {
    const dsl = mk({
      nodes: [agent('a'), agent('b', { prompt: '{{ steps.a.output.text }}' })],
      edges: [edge('a', 'b', 'next')],
    });
    const r = validateDslStructure(dsl);
    expect(r.valid).toBe(true);
  });

  test('E_SELF_REF when node references its own output', () => {
    const dsl = mk({
      nodes: [agent('a'), agent('b', { prompt: '{{ steps.b.output.x }}' })],
      edges: [edge('a', 'b', 'next')],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_SELF_REF')).toBe(true);
  });

  test('E_UNKNOWN_REF when reference targets missing node', () => {
    const dsl = mk({
      nodes: [agent('a'), agent('b', { prompt: '{{ steps.ghost.output.x }}' })],
      edges: [edge('a', 'b', 'next')],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_UNKNOWN_REF')).toBe(true);
  });

  test('E_REF_TOPO_INVALID when reference is not a predecessor', () => {
    // a ↔ b as separate entries; b references a but no path exists
    const dsl = mk({
      nodes: [agent('a'), agent('b', { prompt: '{{ steps.a.output.x }}' }), agent('c')],
      edges: [edge('b', 'c', 'next')],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_REF_TOPO_INVALID')).toBe(true);
  });

  test('while loop condition may reference its own body (do-while / iter N>0 semantics)', () => {
    const dsl = mk({
      nodes: [
        agent('start'),
        {
          id: 'loop', type: 'while',
          input: { condition: { op: 'gt', left: 'steps.inner.output.n', right: 0 }, mode: 'do-while', maxIterations: 10 },
        } as WorkflowNode,
        agent('inner'),
        agent('end'),
      ],
      edges: [
        edge('start', 'loop', 'next'),
        edge('loop', 'inner', 'body'),
        edge('inner', 'loop', 'next'),
        edge('loop', 'end', 'next'),
      ],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_REF_TOPO_INVALID')).toBe(false);
  });

  test('accepts direct-form reference string without braces', () => {
    const dsl = mk({
      nodes: [agent('a'), agent('b', { prompt: 'steps.a.output.text' })],
      edges: [edge('a', 'b', 'next')],
    });
    const r = validateDslStructure(dsl);
    expect(r.valid).toBe(true);
  });

  // ── 12. loop var scope ───────────────────────────────────────────────────
  test('E_LOOP_VAR_LEAK when itemVar used outside for-each body', () => {
    const dsl = mk({
      nodes: [
        {
          id: 'loop',
          type: 'for-each',
          input: { collection: 'steps.a.output.list', itemVar: 'item' },
        } as WorkflowNode,
        agent('a'),
        agent('body', { prompt: 'hi {{ item }}' }),
        agent('after', { prompt: 'leaked {{ item }}' }),
      ],
      edges: [
        edge('a', 'loop', 'next'),
        edge('loop', 'body', 'body'),
        edge('body', 'loop', 'next'),
        edge('loop', 'after', 'next'),
      ],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_LOOP_VAR_LEAK')).toBe(true);
  });

  test('accepts itemVar used inside for-each body', () => {
    const dsl = mk({
      nodes: [
        {
          id: 'loop',
          type: 'for-each',
          input: { collection: 'steps.a.output.list', itemVar: 'item' },
        } as WorkflowNode,
        agent('a'),
        agent('body', { prompt: 'hi {{ item }}' }),
        agent('after', { prompt: 'done' }),
      ],
      edges: [
        edge('a', 'loop', 'next'),
        edge('loop', 'body', 'body'),
        edge('body', 'loop', 'next'),
        edge('loop', 'after', 'next'),
      ],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_LOOP_VAR_LEAK')).toBe(false);
  });

  // ── 13. goto across loop boundary ────────────────────────────────────────
  test('E_GOTO_CROSS_LOOP when onError.goto target leaves loop body', () => {
    const dsl = mk({
      nodes: [
        {
          id: 'loop',
          type: 'for-each',
          input: { collection: 'steps.a.output.list', itemVar: 'x' },
        } as WorkflowNode,
        agent('a'),
        {
          ...agent('body'),
          onError: { action: 'goto', target: 'after' },
        } as WorkflowNode,
        agent('after'),
      ],
      edges: [
        edge('a', 'loop', 'next'),
        edge('loop', 'body', 'body'),
        edge('body', 'loop', 'next'),
        edge('body', 'after', 'on-error'),
        edge('loop', 'after', 'next'),
      ],
    });
    const r = validateDslStructure(dsl);
    expect(hasCode(r, 'E_GOTO_CROSS_LOOP')).toBe(true);
  });
});
