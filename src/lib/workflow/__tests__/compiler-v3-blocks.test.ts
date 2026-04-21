import { extractBlocks, type Block } from '../compiler-v3-blocks';
import type { WorkflowDSLV3, WorkflowEdge, WorkflowNode } from '../types-v3';

const agent = (id: string): WorkflowNode => ({ id, type: 'agent', input: {} }) as WorkflowNode;
const ifElse = (id: string): WorkflowNode => ({
  id, type: 'if-else', input: { condition: { op: 'exists', ref: 'input.x' } },
}) as WorkflowNode;
const forEach = (id: string): WorkflowNode => ({
  id, type: 'for-each', input: { collection: 'steps.x.output.list', itemVar: 'item' },
}) as WorkflowNode;
const parallel = (id: string): WorkflowNode => ({ id, type: 'parallel', input: {} }) as WorkflowNode;
const join = (id: string): WorkflowNode => ({ id, type: 'join', input: {} }) as WorkflowNode;
const edge = (from: string, to: string, kind: WorkflowEdge['kind'], branchIndex?: number): WorkflowEdge =>
  branchIndex === undefined ? { from, to, kind } : { from, to, kind, branchIndex };

const mk = (nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDSLV3 => ({
  version: 'v3', name: 't', nodes, edges,
});

describe('extractBlocks', () => {
  test('single leaf', () => {
    const b = extractBlocks(mk([agent('a')], []));
    expect(b).toEqual({ kind: 'leaf', nodeId: 'a' });
  });

  test('linear sequence a → b → c', () => {
    const b = extractBlocks(mk(
      [agent('a'), agent('b'), agent('c')],
      [edge('a', 'b', 'next'), edge('b', 'c', 'next')],
    ));
    expect(b.kind).toBe('sequence');
    if (b.kind !== 'sequence') throw new Error();
    expect(b.steps.map((s) => (s as { nodeId: string }).nodeId)).toEqual(['a', 'b', 'c']);
  });

  test('if-else with merge', () => {
    // a → if → [then: t] / [else: e] → merge (m) → end
    const dsl = mk(
      [agent('a'), ifElse('if'), agent('t'), agent('e'), agent('m')],
      [
        edge('a', 'if', 'next'),
        edge('if', 't', 'then'),
        edge('if', 'e', 'else'),
        edge('t', 'm', 'next'),
        edge('e', 'm', 'next'),
      ],
    );
    const b = extractBlocks(dsl);
    expect(b.kind).toBe('sequence');
    if (b.kind !== 'sequence') throw new Error();
    const [leafA, ifBlock, leafM] = b.steps;
    expect(leafA).toEqual({ kind: 'leaf', nodeId: 'a' });
    expect(ifBlock.kind).toBe('if-else');
    if (ifBlock.kind !== 'if-else') throw new Error();
    expect(ifBlock.head).toBe('if');
    expect(ifBlock.merge).toBe('m');
    expect(ifBlock.thenBlock).toEqual({ kind: 'leaf', nodeId: 't' });
    expect(ifBlock.elseBlock).toEqual({ kind: 'leaf', nodeId: 'e' });
    expect(leafM).toEqual({ kind: 'leaf', nodeId: 'm' });
  });

  test('for-each loop with body + after', () => {
    const dsl = mk(
      [agent('a'), forEach('loop'), agent('body'), agent('after')],
      [
        edge('a', 'loop', 'next'),
        edge('loop', 'body', 'body'),
        edge('body', 'loop', 'next'),
        edge('loop', 'after', 'next'),
      ],
    );
    const b = extractBlocks(dsl);
    expect(b.kind).toBe('sequence');
    if (b.kind !== 'sequence') throw new Error();
    const loopBlock = b.steps[1];
    expect(loopBlock.kind).toBe('loop');
    if (loopBlock.kind !== 'loop') throw new Error();
    expect(loopBlock.head).toBe('loop');
    expect(loopBlock.loopType).toBe('for-each');
    expect(loopBlock.body).toEqual({ kind: 'leaf', nodeId: 'body' });
    expect((b.steps[2] as { nodeId: string }).nodeId).toBe('after');
  });

  test('parallel + join', () => {
    const dsl = mk(
      [parallel('p'), agent('b1'), agent('b2'), join('j'), agent('end')],
      [
        edge('p', 'b1', 'next', 0),
        edge('p', 'b2', 'next', 1),
        edge('b1', 'j', 'next'),
        edge('b2', 'j', 'next'),
        edge('j', 'end', 'next'),
      ],
    );
    const b = extractBlocks(dsl);
    expect(b.kind).toBe('sequence');
    if (b.kind !== 'sequence') throw new Error();
    const parallelBlock = b.steps[0];
    expect(parallelBlock.kind).toBe('parallel');
    if (parallelBlock.kind !== 'parallel') throw new Error();
    expect(parallelBlock.head).toBe('p');
    expect(parallelBlock.join).toBe('j');
    expect(parallelBlock.branches).toHaveLength(2);
    expect(parallelBlock.branches[0]).toEqual({ kind: 'leaf', nodeId: 'b1' });
    expect(parallelBlock.branches[1]).toEqual({ kind: 'leaf', nodeId: 'b2' });
    // join itself is consumed as the terminator; after it we get 'end'
    const endLeaf = b.steps[b.steps.length - 1];
    expect(endLeaf).toEqual({ kind: 'leaf', nodeId: 'end' });
  });

  test('nested if-else inside for-each body', () => {
    const dsl = mk(
      [agent('entry'), forEach('loop'), ifElse('if'), agent('t'), agent('e'), agent('m')],
      [
        edge('entry', 'loop', 'next'),
        edge('loop', 'if', 'body'),
        edge('if', 't', 'then'),
        edge('if', 'e', 'else'),
        edge('t', 'm', 'next'),
        edge('e', 'm', 'next'),
        edge('m', 'loop', 'next'),
      ],
    );
    const b = extractBlocks(dsl);
    expect(b.kind).toBe('sequence');
    if (b.kind !== 'sequence') throw new Error();
    const loopBlock = b.steps[1];
    expect(loopBlock.kind).toBe('loop');
    if (loopBlock.kind !== 'loop') throw new Error();
    const body = loopBlock.body;
    expect(body.kind).toBe('sequence');
    if (body.kind !== 'sequence') throw new Error();
    expect(body.steps[0].kind).toBe('if-else');
    expect((body.steps[1] as { nodeId: string }).nodeId).toBe('m');
  });

  test('branches sorted by branchIndex', () => {
    const dsl = mk(
      [parallel('p'), agent('b0'), agent('b1'), agent('b2'), join('j')],
      [
        edge('p', 'b2', 'next', 2),
        edge('p', 'b0', 'next', 0),
        edge('p', 'b1', 'next', 1),
        edge('b0', 'j', 'next'),
        edge('b1', 'j', 'next'),
        edge('b2', 'j', 'next'),
      ],
    );
    const b = extractBlocks(dsl);
    // join becomes the terminating leaf in sequence (no further next); wrap is parallel
    if (b.kind !== 'parallel' && b.kind !== 'sequence') throw new Error();
    const parallelBlock = b.kind === 'parallel' ? b : (b.steps[0] as Extract<Block, { kind: 'parallel' }>);
    expect((parallelBlock.branches[0] as { nodeId: string }).nodeId).toBe('b0');
    expect((parallelBlock.branches[1] as { nodeId: string }).nodeId).toBe('b1');
    expect((parallelBlock.branches[2] as { nodeId: string }).nodeId).toBe('b2');
  });
});
