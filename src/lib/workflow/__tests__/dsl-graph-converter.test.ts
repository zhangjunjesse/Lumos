import type { Edge, Node } from '@xyflow/react';
import {
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
});
