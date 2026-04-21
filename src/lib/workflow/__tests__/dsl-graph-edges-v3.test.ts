import { buildEdgesV3 } from '../dsl-graph-edges-v3';
import type { WorkflowDSLV3 } from '../types-v3';

const baseDsl = (edges: WorkflowDSLV3['edges']): WorkflowDSLV3 => ({
  version: 'v3',
  name: 't',
  nodes: [
    { id: 'a', type: 'agent', input: {} },
    { id: 'b', type: 'agent', input: {} },
    { id: 'c', type: 'agent', input: {} },
    { id: 'fallback', type: 'agent', input: {} },
  ],
  edges,
});

describe('buildEdgesV3', () => {
  test('emits one Flow edge per DSL edge', () => {
    const edges = buildEdgesV3(baseDsl([
      { from: 'a', to: 'b', kind: 'next' },
      { from: 'b', to: 'c', kind: 'next' },
    ]));
    expect(edges).toHaveLength(2);
    expect(edges[0].source).toBe('a');
    expect(edges[0].target).toBe('b');
  });

  test('on-error edges get purple stroke + dashed + warning label', () => {
    const edges = buildEdgesV3(baseDsl([
      { from: 'a', to: 'fallback', kind: 'on-error' },
    ]));
    const oe = edges[0];
    expect((oe.style as { stroke: string }).stroke).toBe('#a855f7');
    expect((oe.style as { strokeDasharray?: string }).strokeDasharray).toBe('6 4');
    expect(oe.label).toContain('error');
  });

  test('then/else edges carry distinct colors + labels', () => {
    const edges = buildEdgesV3(baseDsl([
      { from: 'a', to: 'b', kind: 'then' },
      { from: 'a', to: 'c', kind: 'else' },
    ]));
    const then = edges.find((e) => (e.data as { kind: string }).kind === 'then')!;
    const els = edges.find((e) => (e.data as { kind: string }).kind === 'else')!;
    expect((then.style as { stroke: string }).stroke).toBe('#10b981');
    expect((els.style as { stroke: string }).stroke).toBe('#f97316');
    expect(then.label).toBe('then ✓');
    expect(els.label).toBe('else ✗');
  });

  test('next edges have no label (plain control flow)', () => {
    const edges = buildEdgesV3(baseDsl([{ from: 'a', to: 'b', kind: 'next' }]));
    expect(edges[0].label).toBeUndefined();
  });

  test('branchIndex preserved in edge id + data', () => {
    const edges = buildEdgesV3(baseDsl([
      { from: 'a', to: 'b', kind: 'next', branchIndex: 2 },
    ]));
    expect(edges[0].id).toContain('-2');
    expect((edges[0].data as { branchIndex: number }).branchIndex).toBe(2);
  });
});
