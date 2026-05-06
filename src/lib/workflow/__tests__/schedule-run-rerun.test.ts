import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  buildCachedStepsForResume,
  buildReusedRunStepSnapshots,
  findResumeCacheCoverageIssues,
  findFirstTerminalFailedStep,
} from '../schedule-run-rerun-cache';
import {
  buildResumeRuntimeContext,
  clearDebugContext,
  isReusedDebugStep,
  registerDebugContext,
} from '../debug-cache';
import { copyReusedStepOutputArtifacts } from '../schedule-run-rerun-artifacts';
import type { ScheduleRunStep } from '@/lib/db/schedule-run-steps';
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

function sourceStep(stepId: string, status: ScheduleRunStep['status'], outputSummary = ''): ScheduleRunStep {
  return {
    id: `row-${stepId}`,
    runId: 'source-run',
    stepId,
    presetName: '',
    status,
    error: status === 'error' ? 'failed' : '',
    outputSummary,
    durationMs: 1000,
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
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

  it('does not reuse a stale success attempt when the same step later failed', () => {
    const cached = buildCachedStepsForResume({
      dsl: dsl(),
      sourceRunId: 'source-run',
      targetStepId: 'c',
      attempts: [
        attempt('a', 'completed', { success: true, output: { summary: 'old A' } }),
        attempt('a', 'failed', { success: false, output: null, error: 'latest A failed' }),
        attempt('b', 'completed', { success: true, output: { summary: 'B' } }),
      ],
    });

    expect(cached.map((step) => step.stepId)).toEqual(['b']);
  });
});

describe('findResumeCacheCoverageIssues', () => {
  it('reports visible upstream success steps whose reusable output is missing', () => {
    const cached = buildCachedStepsForResume({
      dsl: dsl(),
      sourceRunId: 'source-run',
      targetStepId: 'c',
      attempts: [
        attempt('a', 'completed', { success: true, output: { summary: 'A' } }),
        attempt('b', 'completed'),
      ],
    });

    expect(findResumeCacheCoverageIssues({
      dsl: dsl(),
      targetStepId: 'c',
      cachedSteps: cached,
      sourceSteps: [
        sourceStep('a', 'success', 'A'),
        sourceStep('b', 'success', 'B'),
        sourceStep('c', 'error', 'C failed'),
      ],
    })).toEqual([
      { stepId: 'b', reason: 'missing-output' },
    ]);
  });

  it('falls back to a conservative graph coverage check for legacy runs without visible step rows', () => {
    const cached = buildCachedStepsForResume({
      dsl: dsl(),
      sourceRunId: 'source-run',
      targetStepId: 'c',
      attempts: [
        attempt('a', 'completed', { success: true, output: { summary: 'A' } }),
      ],
    });

    expect(findResumeCacheCoverageIssues({
      dsl: dsl(),
      targetStepId: 'c',
      cachedSteps: cached,
      sourceSteps: [],
    })).toEqual([
      { stepId: 'b', reason: 'missing-output' },
    ]);
  });
});

describe('buildResumeRuntimeContext', () => {
  const workflowRunId = 'workflow-run-for-reused-steps';

  afterEach(() => {
    clearDebugContext(workflowRunId);
  });

  it('marks only reused upstream cache entries as immutable run-step rows', () => {
    const cached = buildCachedStepsForResume({
      dsl: dsl(),
      sourceRunId: 'source-run',
      targetStepId: 'c',
      attempts: [
        attempt('a', 'succeeded', { success: true, output: { summary: 'A' } }),
        attempt('b', 'completed', { success: true, output: { summary: 'B' } }),
        attempt('c', 'failed', { success: false, output: null, error: 'C failed' }),
      ],
    });
    const ctx = buildResumeRuntimeContext({
      sessionId: 'rerun:new-run',
      targetStepId: 'c',
      dsl: dsl(),
      cachedSteps: cached,
    });

    registerDebugContext(workflowRunId, ctx);

    expect(isReusedDebugStep(workflowRunId, 'a')).toBe(true);
    expect(isReusedDebugStep(workflowRunId, 'b')).toBe(true);
    expect(isReusedDebugStep(workflowRunId, 'c')).toBe(false);
  });

  it('can mark seeded non-cache rows as immutable for production rerun details', () => {
    const ctx = buildResumeRuntimeContext({
      sessionId: 'rerun:new-run',
      targetStepId: 'c',
      dsl: dsl(),
      cachedSteps: [],
      reusedStepIds: ['a', 'b'],
    });

    registerDebugContext(workflowRunId, ctx);

    expect(isReusedDebugStep(workflowRunId, 'a')).toBe(true);
    expect(isReusedDebugStep(workflowRunId, 'b')).toBe(true);
    expect(isReusedDebugStep(workflowRunId, 'c')).toBe(false);
  });
});

describe('buildReusedRunStepSnapshots', () => {
  it('preserves source run-step status metadata for cached upstream steps', () => {
    const cached = buildCachedStepsForResume({
      dsl: dsl(),
      sourceRunId: 'source-run',
      targetStepId: 'c',
      attempts: [
        attempt('a', 'succeeded', { success: true, output: { summary: 'cached A' } }),
        attempt('b', 'completed', { success: true, output: { summary: 'cached B' } }),
        attempt('c', 'failed', { success: false, output: null, error: 'C failed' }),
      ],
    });
    const sourceSteps: ScheduleRunStep[] = [
      {
        id: 'row-a',
        runId: 'source-run',
        stepId: 'a',
        presetName: '分析师',
        status: 'success',
        error: '',
        outputSummary: 'source summary A',
        durationMs: 1234,
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:01.234Z',
      },
    ];

    const snapshots = buildReusedRunStepSnapshots({ cachedSteps: cached, sourceSteps });

    expect(snapshots).toEqual([
      expect.objectContaining({
        stepId: 'a',
        presetName: '分析师',
        status: 'success',
        outputSummary: 'source summary A',
        durationMs: 1234,
      }),
      expect.objectContaining({
        stepId: 'b',
        status: 'success',
        outputSummary: 'cached B',
      }),
    ]);
  });

  it('seeds visible reusable source rows even when they do not need runtime cache', () => {
    const sourceSteps: ScheduleRunStep[] = [
      sourceStep('a', 'success', 'source summary A'),
      sourceStep('b', 'skipped', 'source skipped B'),
      sourceStep('c', 'error', 'target failed'),
      sourceStep('d', 'success', 'downstream D'),
    ];

    const snapshots = buildReusedRunStepSnapshots({
      cachedSteps: [
        {
          sessionId: 'rerun:source-run',
          stepId: 'a',
          output: { summary: 'cached A' },
          metadata: {},
          status: 'success',
          durationMs: 1000,
          completedAt: '2026-01-01T00:00:01.000Z',
          configHash: 'hash-a',
        },
      ],
      sourceSteps,
      dsl: dsl(),
      targetStepId: 'c',
    });

    expect(snapshots.map((step) => [step.stepId, step.status, step.outputSummary])).toEqual([
      ['a', 'success', 'source summary A'],
      ['b', 'skipped', 'source skipped B'],
    ]);
  });
});

describe('copyReusedStepOutputArtifacts', () => {
  const originalDataDir = process.env.LUMOS_DATA_DIR;
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'lumos-rerun-artifacts-'));
    process.env.LUMOS_DATA_DIR = tempDir;
  });

  afterEach(async () => {
    if (originalDataDir === undefined) {
      delete process.env.LUMOS_DATA_DIR;
    } else {
      process.env.LUMOS_DATA_DIR = originalDataDir;
    }
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it('copies reused upstream step output files into the new workflow run workspace', async () => {
    const sourceOutputDir = path.join(
      tempDir,
      'workflow-agent-runs',
      'source-run',
      'stages',
      'a',
      'output',
    );
    await mkdir(sourceOutputDir, { recursive: true });
    await writeFile(path.join(sourceOutputDir, 'report.md'), '# upstream artifact\n', 'utf-8');

    const result = await copyReusedStepOutputArtifacts({
      sourceWorkflowRunId: 'source-run',
      targetWorkflowRunId: 'target-run',
      stepIds: ['a', 'missing-output-step'],
    });
    expect(result).toEqual({
      copiedStepIds: ['a'],
      warnings: [],
    });

    await expect(readFile(path.join(
      tempDir,
      'workflow-agent-runs',
      'target-run',
      'stages',
      'a',
      'output',
      'report.md',
    ), 'utf-8')).resolves.toBe('# upstream artifact\n');
  });
});
