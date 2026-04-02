import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  StageExecutionPayloadV1,
  StageExecutionResultV1,
} from '@/lib/team-run/runtime-contracts';

const mockBuildClaudeSdkRuntimeBootstrap = jest.fn();
const mockGetSetting = jest.fn();
const mockGetSession = jest.fn();
const mockGetDefaultProvider = jest.fn();
const mockGetProvider = jest.fn();

jest.mock('@/lib/claude/sdk-runtime', () => ({
  buildClaudeSdkRuntimeBootstrap: (...args: unknown[]) => mockBuildClaudeSdkRuntimeBootstrap(...args),
}));

jest.mock('@/lib/db/sessions', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
  setSetting: jest.fn(),
}));

jest.mock('@/lib/db/providers', () => ({
  getDefaultProvider: (...args: unknown[]) => mockGetDefaultProvider(...args),
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
}));

jest.mock('@/lib/db/workflow-agent-presets', () => ({
  getWorkflowAgentPreset: jest.fn().mockReturnValue(undefined),
}));

import { StageWorker } from '@/lib/team-run/stage-worker';
import {
  cancelWorkflowAgentExecution,
  executeWorkflowAgentStep,
} from '../subagent';

function buildStageExecutionResult(
  overrides: Partial<StageExecutionResultV1> = {},
): StageExecutionResultV1 {
  return {
    contractVersion: 'stage-execution-result/v1',
    runId: 'wf-001',
    stageId: 'draft',
    attempt: 1,
    outcome: 'done',
    summary: 'Stage completed.',
    artifacts: [],
    metrics: {
      startedAt: '2026-03-20T00:00:00.000Z',
      finishedAt: '2026-03-20T00:00:01.000Z',
      durationMs: 1000,
    },
    ...overrides,
  };
}

describe('executeWorkflowAgentStep', () => {
  let stageWorkerExecuteSpy: jest.SpyInstance
  let previousDataDir: string | undefined
  let tempDataDir: string
  let previousExecutionMode: string | undefined
  let previousSyntheticDelay: string | undefined

  beforeEach(() => {
    previousDataDir = process.env.LUMOS_DATA_DIR
    previousExecutionMode = process.env.LUMOS_WORKFLOW_AGENT_STEP_MODE
    previousSyntheticDelay = process.env.LUMOS_WORKFLOW_AGENT_STEP_SYNTHETIC_DELAY_MS
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-subagent-test-'))
    process.env.LUMOS_DATA_DIR = tempDataDir
    stageWorkerExecuteSpy = jest.spyOn(StageWorker.prototype, 'execute')
    mockBuildClaudeSdkRuntimeBootstrap.mockReset();
    mockGetSetting.mockReset();
    mockGetSetting.mockReturnValue('');
    mockGetSession.mockReset();
    mockGetSession.mockReturnValue(undefined);
    mockGetDefaultProvider.mockReset();
    mockGetDefaultProvider.mockReturnValue(undefined);
    mockGetProvider.mockReset();
    mockGetProvider.mockReturnValue(undefined);
    mockBuildClaudeSdkRuntimeBootstrap.mockReturnValue({
      env: {},
      settingSources: [],
      pathToClaudeCodeExecutable: '/tmp/claude',
    });
  });

  afterEach(() => {
    stageWorkerExecuteSpy.mockRestore()
    if (previousDataDir === undefined) {
      delete process.env.LUMOS_DATA_DIR
    } else {
      process.env.LUMOS_DATA_DIR = previousDataDir
    }
    if (previousExecutionMode === undefined) {
      delete process.env.LUMOS_WORKFLOW_AGENT_STEP_MODE
    } else {
      process.env.LUMOS_WORKFLOW_AGENT_STEP_MODE = previousExecutionMode
    }
    if (previousSyntheticDelay === undefined) {
      delete process.env.LUMOS_WORKFLOW_AGENT_STEP_SYNTHETIC_DELAY_MS
    } else {
      process.env.LUMOS_WORKFLOW_AGENT_STEP_SYNTHETIC_DELAY_MS = previousSyntheticDelay
    }
    fs.rmSync(tempDataDir, { recursive: true, force: true })
  })

  test('auto mode falls back to synthetic execution and preserves workflow runtime context', async () => {
    stageWorkerExecuteSpy.mockResolvedValue(buildStageExecutionResult());

    const result = await executeWorkflowAgentStep({
      prompt: 'Implement the workflow task.',
      role: 'coder',
      __runtime: {
        workflowRunId: 'wf-001',
        stepId: 'draft',
        stepType: 'agent',
        taskId: 'task-001',
        sessionId: 'session-001',
        requestedModel: 'claude-sonnet-4-6',
        workingDirectory: '/tmp/workflow-session-001',
      },
    });

    expect(stageWorkerExecuteSpy).toHaveBeenCalledTimes(1);
    const payload = stageWorkerExecuteSpy.mock.calls[0][0] as StageExecutionPayloadV1;
    expect(payload.runId).toBe('wf-001');
    expect(payload.stageId).toBe('draft');
    expect(payload.taskId).toBe('task-001');
    expect(payload.sessionId).toBe('session-001');
    expect(payload.requestedModel).toBe('claude-sonnet-4-6');
    expect(payload.workspace.sessionWorkspace).toBe('/tmp/workflow-session-001');
    expect(payload.agent).toMatchObject({
      agentType: 'workflow.coder',
      roleName: 'Workflow Code Agent',
      allowedTools: ['workspace.read', 'workspace.write', 'shell.exec'],
    });
    expect(payload.stage.outputContract).toEqual({
      primaryFormat: 'markdown',
      mustProduceSummary: true,
      mayProduceArtifacts: false,
      artifactKinds: [],
    });
    expect(payload.stage.acceptanceCriteria).toContain(
      'Return summary text only; keep the artifacts array empty for workflow agent steps.',
    );

    expect(result).toMatchObject({
      success: true,
      metadata: {
        workflowRunId: 'wf-001',
        stepId: 'draft',
        executionMode: 'synthetic',
        role: 'coder',
        agentType: 'workflow.coder',
        requestedModel: 'claude-sonnet-4-6',
        sessionId: 'session-001',
      },
    });
    expect((result.output as Record<string, unknown>).role).toBe('coder');
  });

  test('claude mode is enabled when auth is available and requested tools only narrow allowed capabilities', async () => {
    mockGetDefaultProvider.mockReturnValue({
      id: 'test-provider',
      provider_type: 'openai',
      auth_mode: 'api_key',
      api_key: 'test-api-key',
      extra_env: '{}',
    });
    stageWorkerExecuteSpy.mockResolvedValue(
      buildStageExecutionResult({
        outcome: 'blocked',
        error: {
          code: 'needs_input',
          message: 'Need more input.',
          retryable: false,
        },
      }),
    );

    const result = await executeWorkflowAgentStep({
      prompt: 'Research the repository.',
      role: 'researcher',
      tools: ['read_file', 'write_file', 'unknown_tool'],
      __runtime: {
        workflowRunId: 'wf-002',
        stepId: 'research',
        stepType: 'agent',
      },
    });

    expect(stageWorkerExecuteSpy).toHaveBeenCalledTimes(1);
    const payload = stageWorkerExecuteSpy.mock.calls[0][0] as StageExecutionPayloadV1;
    expect(payload.agent).toMatchObject({
      agentType: 'workflow.researcher',
      allowedTools: ['workspace.read'],
    });

    expect(result).toMatchObject({
      success: false,
      error: 'Need more input.',
      metadata: {
        workflowRunId: 'wf-002',
        stepId: 'research',
        executionMode: 'claude',
        role: 'researcher',
        allowedTools: ['workspace.read'],
        ignoredToolRequests: ['unknown_tool'],
      },
    });
    expect((result.output as Record<string, unknown>).outcome).toBe('blocked');
  });

  test('maps workflow agent context into dependency payloads for downstream synthesis', async () => {
    stageWorkerExecuteSpy.mockResolvedValue(buildStageExecutionResult({
      stageId: 'aggregate',
    }));

    await executeWorkflowAgentStep({
      prompt: '请汇总所有并行分支结果。',
      role: 'integration',
      context: {
        analysis: '先比较标题与截图质量。',
        branch_1: {
          url: 'https://example.com',
          title: 'Example Domain',
          screenshotPath: '/tmp/workflow-branch-1.png',
        },
      },
      __runtime: {
        workflowRunId: 'wf-004',
        stepId: 'aggregate',
        stepType: 'agent',
      },
    });

    const payload = stageWorkerExecuteSpy.mock.calls[0][0] as StageExecutionPayloadV1;
    expect(payload.dependencies).toEqual([
      {
        stageId: 'analysis',
        title: 'analysis',
        summary: '先比较标题与截图质量。',
        artifactRefs: [],
      },
      {
        stageId: 'branch_1',
        title: 'branch_1',
        summary: 'Example Domain',
        artifactRefs: ['/tmp/workflow-branch-1.png'],
      },
    ]);
    expect(payload.stage.acceptanceCriteria).toContain(
      'Use the provided dependency context to produce an integrated result; do not ignore branch outputs.',
    );
  });

  test('successful plain-text delivery diagnostics do not populate the step error field', async () => {
    stageWorkerExecuteSpy.mockResolvedValue(buildStageExecutionResult({
      stageId: 'finalize',
      diagnostics: {
        errorName: 'PlainTextDeliveryMode',
        sanitizedMessage: 'Plain-text delivery mode used',
        rawMessage: 'Runtime requested plain-text stage delivery',
      },
    }));

    const result = await executeWorkflowAgentStep({
      prompt: '生成最终正文。',
      role: 'integration',
      outputMode: 'plain-text',
      __runtime: {
        workflowRunId: 'wf-005',
        stepId: 'finalize',
        stepType: 'agent',
      },
    });

    expect(result).toMatchObject({
      success: true,
      error: undefined,
      metadata: {
        workflowRunId: 'wf-005',
        stepId: 'finalize',
      },
    });
    expect((result.output as Record<string, unknown>).diagnostics).toMatchObject({
      sanitizedMessage: 'Plain-text delivery mode used',
    });
  });

  test('cancel interrupts an in-flight synthetic workflow agent execution before worker execute starts', async () => {
    process.env.LUMOS_WORKFLOW_AGENT_STEP_MODE = 'synthetic';
    process.env.LUMOS_WORKFLOW_AGENT_STEP_SYNTHETIC_DELAY_MS = '2000';

    const resultPromise = executeWorkflowAgentStep({
      prompt: 'Wait for cancellation.',
      role: 'worker',
      __runtime: {
        workflowRunId: 'wf-003',
        stepId: 'draft',
        stepType: 'agent',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 30));

    const cancelled = await cancelWorkflowAgentExecution({
      workflowRunId: 'wf-003',
      stepId: 'draft',
    });
    const result = await resultPromise;
    const cancelledAgain = await cancelWorkflowAgentExecution({
      workflowRunId: 'wf-003',
      stepId: 'draft',
    });

    expect(cancelled).toBe(true);
    expect(cancelledAgain).toBe(false);
    expect(stageWorkerExecuteSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      error: 'Task execution cancelled',
      metadata: {
        workflowRunId: 'wf-003',
        stepId: 'draft',
        executionMode: 'synthetic',
        cancelled: true,
      },
    });
  });
});
