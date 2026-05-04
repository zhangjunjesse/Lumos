import {
  buildCachedStepsForResume,
  findFirstTerminalFailedStep,
} from '../schedule-run-rerun-cache';
import type { WorkflowDSLV3, WorkflowEdge, WorkflowNode } from '../types-v3';

type Attempt = Parameters<typeof findFirstTerminalFailedStep>[0][number];

function agent(id: string): WorkflowNode {
  return {
    id,
    type: 'agent',
    input: { prompt: id },
  } as WorkflowNode;
}

function edge(from: string, to: string): WorkflowEdge {
  return { from, to, kind: 'next' };
}

function dsl(): WorkflowDSLV3 {
  return {
    version: 'v3',
    name: 'rerun-test',
    nodes: [agent('a'), agent('b'), agent('c'), agent('d')],
    edges: [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')],
  };
}

function attempt(stepName: string, status: string, output?: unknown): Attempt {
  return {
    step_name: stepName,
    status,
    output: output === undefined ? null : JSON.stringify(output),
    error: status === 'failed' ? 'failed' : null,
    started_at: '2026-01-01T00:00:00.000Z',
    finished_at: '2026-01-01T00:00:01.000Z',
    created_at: `2026-01-01T00:00:0${attemptCounter++}.000Z`,
  };
}

let attemptCounter = 0;

beforeEach(() => {
  attemptCounter = 0;
});

describe('findFirstTerminalFailedStep', () => {
  it('ignores a failed attempt when the same step later completed', () => {
    const start = findFirstTerminalFailedStep([
      attempt('a', 'completed'),
      attempt('b', 'failed'),
      attempt('b', 'completed'),
      attempt('c', 'failed'),
    ], dsl());

    expect(start).toBe('c');
  });

  it('returns null when failed attempts are later covered by success', () => {
    const start = findFirstTerminalFailedStep([
      attempt('a', 'completed'),
      attempt('b', 'failed'),
      attempt('b', 'completed'),
      attempt('c', 'succeeded'),
    ], dsl());

    expect(start).toBeNull();
  });
});

describe('buildCachedStepsForResume', () => {
  it('reuses completed upstream steps and omits target/downstream steps', () => {
    const cached = buildCachedStepsForResume({
      dsl: dsl(),
      sourceRunId: 'source-run',
      targetStepId: 'c',
      attempts: [
        attempt('a', 'succeeded', { success: true, output: { summary: 'A' } }),
        attempt('b', 'completed', { success: true, output: { summary: 'B' } }),
        attempt('c', 'completed', { success: true, output: { summary: 'C' } }),
        attempt('d', 'completed', { success: true, output: { summary: 'D' } }),
      ],
    });

    expect(cached.map((step) => step.stepId)).toEqual(['a', 'b']);
    expect(cached[0]?.output).toEqual({ summary: 'A' });
    expect(cached[0]?.metadata).toMatchObject({
      fromProductionRun: true,
      sourceRunId: 'source-run',
    });
  });
});
