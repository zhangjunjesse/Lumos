import type { Edge, Node } from '@xyflow/react';
import {
  dslToGraph,
  graphToDsl,
  removeStepFromDsl,
  type StepNodeData,
} from '../dsl-graph-converter';

describe('workflow graph DSL editing helpers', () => {
  test('removeStepFromDsl prunes deleted step ids from dependencies and control-flow refs', () => {
    const dsl = {
      version: 'v2',
      name: 'Delete node workflow',
      steps: [
        {
          id: 'gate',
          type: 'if-else',
          input: {
            condition: { op: 'exists', ref: 'input.flag' },
            then: ['worker'],
            else: ['fallback'],
          },
        },
        {
          id: 'worker',
          type: 'agent',
          input: { prompt: 'work' },
        },
        {
          id: 'fallback',
          type: 'agent',
          dependsOn: ['worker'],
          input: { prompt: 'fallback' },
        },
      ],
    };

    const next = removeStepFromDsl(dsl, 'worker');
    const gate = next.steps.find((step) => step.id === 'gate');
    const fallback = next.steps.find((step) => step.id === 'fallback');

    expect(next.steps.map((step) => step.id)).toEqual(['gate', 'fallback']);
    expect(gate?.input).toMatchObject({
      then: [],
      else: ['fallback'],
    });
    expect(fallback?.dependsOn).toBeUndefined();
  });

  test('removeStepFromDsl prunes deleted step output references from generic input context', () => {
    const dsl = {
      version: 'v2',
      name: 'Delete referenced node',
      steps: [
        {
          id: 'download',
          type: 'agent',
          input: { prompt: 'download' },
        },
        {
          id: 'wait',
          type: 'agent',
          input: {
            prompt: 'wait',
            context: {
              downloadStatus: 'steps.download.output.summary',
              preserved: 'literal text',
            },
          },
        },
      ],
    };

    const next = removeStepFromDsl(dsl, 'download');
    const wait = next.steps.find((step) => step.id === 'wait');

    expect(wait?.input).toEqual({
      prompt: 'wait',
      context: {
        preserved: 'literal text',
      },
    });
  });

  test('removeStepFromDsl drops when clauses that still reference deleted steps', () => {
    const dsl = {
      version: 'v2',
      name: 'Delete conditional node',
      steps: [
        {
          id: 'login',
          type: 'agent',
          input: { prompt: 'login' },
        },
        {
          id: 'download',
          type: 'agent',
          when: {
            op: 'exists',
            ref: 'steps.login.output.summary',
          },
          input: { prompt: 'download' },
        },
      ],
    };

    const next = removeStepFromDsl(dsl, 'login');
    const download = next.steps.find((step) => step.id === 'download');

    expect(download?.when).toBeUndefined();
  });

  test('graphToDsl prunes dangling control-flow references after canvas deletion', () => {
    const baseDsl = {
      version: 'v2',
      name: 'Visual workflow',
      steps: [
        {
          id: 'gate',
          type: 'if-else',
          input: {
            condition: { op: 'exists', ref: 'input.flag' },
            then: ['worker'],
            else: ['fallback'],
          },
        },
        {
          id: 'worker',
          type: 'agent',
          input: { prompt: 'work' },
        },
        {
          id: 'fallback',
          type: 'agent',
          input: { prompt: 'fallback' },
        },
      ],
    };

    const nodes: Array<Node<StepNodeData>> = [
      {
        id: 'gate',
        type: 'if-else',
        position: { x: 0, y: 0 },
        data: {
          stepId: 'gate',
          stepType: 'if-else',
          label: 'IF / ELSE',
          input: {
            condition: { op: 'exists', ref: 'input.flag' },
            then: ['worker'],
            else: ['fallback'],
          },
          dependsOn: [],
        },
      },
      {
        id: 'fallback',
        type: 'agent',
        position: { x: 200, y: 0 },
        data: {
          stepId: 'fallback',
          stepType: 'agent',
          label: 'fallback',
          input: { prompt: 'fallback' },
          dependsOn: [],
        },
      },
    ];
    const edges: Edge[] = [];

    const next = graphToDsl(nodes, edges, baseDsl);
    const gate = next.steps.find((step) => step.id === 'gate');

    expect(next.steps.map((step) => step.id)).toEqual(['gate', 'fallback']);
    expect(gate?.input).toMatchObject({
      then: [],
      else: ['fallback'],
    });
  });

  describe('nested containers', () => {
    const nestedDsl = {
      version: 'v2',
      name: 'Nested workflow',
      steps: [
        {
          id: 'outer',
          type: 'while',
          input: {
            condition: { op: 'exists', ref: 'input.more' },
            body: ['gate'],
            maxIterations: 5,
          },
        },
        {
          id: 'gate',
          type: 'if-else',
          input: {
            condition: { op: 'exists', ref: 'input.flag' },
            then: ['a'],
            else: ['b'],
          },
        },
        { id: 'a', type: 'agent', input: { prompt: 'a' } },
        { id: 'b', type: 'agent', input: { prompt: 'b' } },
      ],
    };

    test('dslToGraph sets parentId chain and branch metadata', () => {
      const { nodes } = dslToGraph(nestedDsl);
      const byId = new Map(nodes.map(n => [n.id, n]));
      expect(byId.get('outer')?.parentId).toBeUndefined();
      expect(byId.get('gate')?.parentId).toBe('outer');
      expect(byId.get('a')?.parentId).toBe('gate');
      expect(byId.get('b')?.parentId).toBe('gate');
      expect(byId.get('a')?.data.branch).toBe('then');
      expect(byId.get('b')?.data.branch).toBe('else');
    });

    test('containers receive style width/height from recursive layout', () => {
      const { nodes } = dslToGraph(nestedDsl);
      const outer = nodes.find(n => n.id === 'outer');
      const gate = nodes.find(n => n.id === 'gate');
      expect(typeof outer?.style?.width).toBe('number');
      expect(typeof outer?.style?.height).toBe('number');
      expect(typeof gate?.style?.width).toBe('number');
      expect(typeof gate?.style?.height).toBe('number');
      // outer is bigger than gate since it contains it plus chrome
      expect(Number(outer?.style?.width)).toBeGreaterThan(Number(gate?.style?.width));
      expect(Number(outer?.style?.height)).toBeGreaterThan(Number(gate?.style?.height));
    });

    test('round-trip preserves nested body, then, else order', () => {
      const { nodes, edges } = dslToGraph(nestedDsl);
      const out = graphToDsl(nodes as Node<StepNodeData>[], edges, nestedDsl);
      const outer = out.steps.find(s => s.id === 'outer');
      const gate = out.steps.find(s => s.id === 'gate');
      expect(outer?.input).toMatchObject({ body: ['gate'] });
      expect(gate?.input).toMatchObject({ then: ['a'], else: ['b'] });
    });

    test('round-trip splits if-else children into correct branches via data.branch', () => {
      const { nodes, edges } = dslToGraph(nestedDsl);
      // Shuffle node order; branch assignment should still work
      const shuffled = [...nodes].reverse();
      const out = graphToDsl(shuffled as Node<StepNodeData>[], edges, nestedDsl);
      const gate = out.steps.find(s => s.id === 'gate');
      expect((gate?.input?.then as string[])).toContain('a');
      expect((gate?.input?.else as string[])).toContain('b');
    });

    test('graphToDsl prefers data.branch over y-position heuristic', () => {
      const base = {
        version: 'v2', name: 't',
        steps: [
          { id: 'gate', type: 'if-else', input: { condition: {}, then: ['x'], else: ['y'] } },
          { id: 'x', type: 'agent', input: { prompt: '' } },
          { id: 'y', type: 'agent', input: { prompt: '' } },
        ],
      };
      // Flip x/y vertical positions AND branch metadata; branch should win
      const nodes: Node<StepNodeData>[] = [
        { id: 'gate', type: 'if-else', position: { x: 0, y: 0 },
          data: { stepId: 'gate', stepType: 'if-else', label: '', input: {}, dependsOn: [], isContainer: true }},
        { id: 'y', type: 'agent', parentId: 'gate', extent: 'parent', position: { x: 20, y: 40 },
          data: { stepId: 'y', stepType: 'agent', label: 'y', input: {}, dependsOn: [], branch: 'else' }},
        { id: 'x', type: 'agent', parentId: 'gate', extent: 'parent', position: { x: 20, y: 160 },
          data: { stepId: 'x', stepType: 'agent', label: 'x', input: {}, dependsOn: [], branch: 'then' }},
      ];
      const out = graphToDsl(nodes, [], base);
      const gate = out.steps.find(s => s.id === 'gate');
      expect(gate?.input).toMatchObject({ then: ['x'], else: ['y'] });
    });
  });

  describe('data reference edges', () => {
    test('dslToGraph adds dashed ref edge for non-adjacent body-sibling context reference', () => {
      const dsl = {
        version: 'v2',
        name: 't',
        steps: [
          {
            id: 'loop',
            type: 'while',
            input: {
              condition: { op: 'exists', ref: 'input.x' },
              body: ['a', 'mid', 'c'],
              maxIterations: 2,
            },
          },
          { id: 'a', type: 'agent', input: { prompt: '' } },
          { id: 'mid', type: 'agent', input: { prompt: '' } },
          {
            id: 'c',
            type: 'agent',
            input: { prompt: '', context: { x: 'steps.a.output.summary' } },
          },
        ],
      };
      const { edges } = dslToGraph(dsl);
      const ref = edges.find(e => e.id === 'ref-a-c');
      expect(ref).toBeDefined();
      expect(ref?.data?.kind).toBe('ref');
      expect((ref?.style as { strokeDasharray?: string })?.strokeDasharray).toBeDefined();
    });

    test('dslToGraph adds order edges for adjacent body-array steps', () => {
      const dsl = {
        version: 'v2',
        name: 't',
        steps: [
          {
            id: 'loop',
            type: 'while',
            input: {
              condition: { op: 'exists', ref: 'input.x' },
              body: ['a', 'b', 'c'],
              maxIterations: 2,
            },
          },
          { id: 'a', type: 'agent', input: { prompt: '' } },
          { id: 'b', type: 'agent', input: { prompt: '' } },
          { id: 'c', type: 'agent', input: { prompt: '' } },
        ],
      };
      const { edges } = dslToGraph(dsl);
      const ab = edges.find(e => e.id === 'order-a-b');
      const bc = edges.find(e => e.id === 'order-b-c');
      expect(ab).toBeDefined();
      expect(bc).toBeDefined();
      expect(ab?.data?.kind).toBe('order');
      expect(bc?.data?.kind).toBe('order');
    });

    test('body-internal dependsOn is downgraded to ref style (runtime ignores it)', () => {
      const dsl = {
        version: 'v2',
        name: 't',
        steps: [
          {
            id: 'loop',
            type: 'while',
            input: {
              condition: { op: 'exists', ref: 'input.x' },
              body: ['a', 'b', 'c'],
              maxIterations: 2,
            },
          },
          { id: 'a', type: 'agent', input: { prompt: '' } },
          { id: 'b', type: 'agent', input: { prompt: '' } },
          { id: 'c', type: 'agent', dependsOn: ['a'], input: { prompt: '' } },
        ],
      };
      const { edges } = dslToGraph(dsl);
      const e = edges.find(x => x.id === 'dep-a-c');
      expect(e).toBeDefined();
      expect(e?.data?.kind).toBe('ref');
      expect((e?.style as { strokeDasharray?: string })?.strokeDasharray).toBeDefined();
    });

    test('dslToGraph skips ref edge when dep edge already exists for same pair', () => {
      const dsl = {
        version: 'v2',
        name: 't',
        steps: [
          { id: 'a', type: 'agent', input: { prompt: '' } },
          {
            id: 'b',
            type: 'agent',
            dependsOn: ['a'],
            input: { prompt: '', context: { x: 'steps.a.output.summary' } },
          },
        ],
      };
      const { edges } = dslToGraph(dsl);
      expect(edges.find(e => e.id === 'ref-a-b')).toBeUndefined();
      const dep = edges.find(e => e.id === 'dep-a-b');
      expect(dep).toBeDefined();
      expect(dep?.data?.kind).toBe('dep');
    });

    test('cross-container dep edge is styled as ref and marked data.kind=ref', () => {
      const dsl = {
        version: 'v2',
        name: 't',
        steps: [
          { id: 'brief', type: 'agent', input: { prompt: '' } },
          {
            id: 'loop',
            type: 'while',
            input: {
              condition: { op: 'exists', ref: 'input.x' },
              body: ['inner'],
              maxIterations: 2,
            },
          },
          {
            id: 'inner',
            type: 'agent',
            dependsOn: ['brief'],
            input: { prompt: '', context: { b: 'steps.brief.output.summary' } },
          },
        ],
      };
      const { edges } = dslToGraph(dsl);
      const e = edges.find(x => x.id === 'dep-brief-inner');
      expect(e).toBeDefined();
      expect(e?.data?.kind).toBe('ref');
      expect((e?.style as { strokeDasharray?: string })?.strokeDasharray).toBeDefined();
    });

    test('dslToGraph ignores self-references and unknown step ids', () => {
      const dsl = {
        version: 'v2',
        name: 't',
        steps: [
          {
            id: 'a',
            type: 'agent',
            input: {
              prompt: 'see steps.a.output.x and steps.ghost.output.y',
            },
          },
        ],
      };
      const { edges } = dslToGraph(dsl);
      expect(edges.filter(e => e.id.startsWith('ref-'))).toHaveLength(0);
    });
  });

  describe('top-level layout overlap', () => {
    test('tall container does not vertically overlap a sibling top-level node', () => {
      const dsl = {
        version: 'v2',
        name: 't',
        steps: [
          { id: 'root', type: 'agent', input: { prompt: '' } },
          { id: 'brief', type: 'agent', dependsOn: ['root'], input: { prompt: '' } },
          {
            id: 'loop',
            type: 'while',
            dependsOn: ['root'],
            input: {
              condition: { op: 'exists', ref: 'input.x' },
              body: ['b1', 'b2', 'b3', 'b4'],
              maxIterations: 3,
            },
          },
          { id: 'b1', type: 'agent', input: { prompt: '' } },
          { id: 'b2', type: 'agent', input: { prompt: '' } },
          { id: 'b3', type: 'agent', input: { prompt: '' } },
          { id: 'b4', type: 'agent', input: { prompt: '' } },
        ],
      };
      const { nodes } = dslToGraph(dsl);
      const brief = nodes.find(n => n.id === 'brief')!;
      const loop = nodes.find(n => n.id === 'loop')!;
      const briefW = 180;
      const briefH = 52;
      const loopW = Number(loop.style?.width);
      const loopH = Number(loop.style?.height);

      const xOverlap =
        brief.position.x < loop.position.x + loopW &&
        loop.position.x < brief.position.x + briefW;
      const yOverlap =
        brief.position.y < loop.position.y + loopH &&
        loop.position.y < brief.position.y + briefH;

      expect(xOverlap && yOverlap).toBe(false);
    });
  });
});
