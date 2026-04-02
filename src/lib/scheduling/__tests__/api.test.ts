import { TaskStatus, type Task, type UpdateTaskStatusRequest } from '@/lib/task-management/types';
import type { SchedulingPlan } from '../planner';

const mockSubmitWorkflow = jest.fn();
const mockCancelWorkflow = jest.fn();
const mockHandleGenerateWorkflowTool = jest.fn();
const mockCancelWorkflowAgentExecution = jest.fn();
const mockExecuteWorkflowAgentStep = jest.fn();
const mockResolveSchedulingPlan = jest.fn();
const mockGetSession = jest.fn();

jest.mock('@/lib/workflow/api', () => ({
  submitWorkflow: (...args: unknown[]) => mockSubmitWorkflow(...args),
  cancelWorkflow: (...args: unknown[]) => mockCancelWorkflow(...args),
}));

jest.mock('@/lib/workflow/mcp-tool', () => ({
  handleGenerateWorkflowTool: (...args: unknown[]) => mockHandleGenerateWorkflowTool(...args),
}));

jest.mock('@/lib/workflow/subagent', () => ({
  cancelWorkflowAgentExecution: (...args: unknown[]) => mockCancelWorkflowAgentExecution(...args),
  executeWorkflowAgentStep: (...args: unknown[]) => mockExecuteWorkflowAgentStep(...args),
}));

jest.mock('../planner', () => ({
  resolveSchedulingPlan: (...args: unknown[]) => mockResolveSchedulingPlan(...args),
}));

jest.mock('@/lib/db/sessions', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

import { acceptTask, cancelAcceptedTask, resetSchedulingForTests } from '../api';

function buildTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-scheduling-test-001',
    sessionId: overrides.sessionId ?? 'session-test-001',
    summary: overrides.summary ?? '整理当前项目中的 workflow 架构实现',
    requirements: overrides.requirements ?? ['输出结论', '保持最小改动'],
    status: overrides.status ?? TaskStatus.PENDING,
    progress: overrides.progress ?? 0,
    createdAt: overrides.createdAt ?? new Date('2026-03-20T00:00:00.000Z'),
    metadata: overrides.metadata ?? {},
  };
}

function buildWorkflowPlan(taskId: string): SchedulingPlan {
  return {
    strategy: 'workflow',
    source: 'llm',
    reason: 'Workflow orchestration is required.',
    estimatedDurationSeconds: 120,
    analysis: {
      complexity: 'moderate',
      needsBrowser: false,
      needsNotification: false,
      needsMultipleSteps: true,
      needsParallel: false,
    },
    workflowDsl: {
      version: 'v1',
      name: `task-${taskId}`,
      steps: [
        {
          id: 'main',
          type: 'agent',
          input: {
            prompt: '完成任务',
            role: 'worker',
          },
        },
      ],
    },
  };
}

function buildSimplePlan(): SchedulingPlan {
  return {
    strategy: 'simple',
    source: 'llm',
    reason: 'Task is simple enough for direct execution.',
    estimatedDurationSeconds: 45,
    analysis: {
      complexity: 'simple',
      needsBrowser: false,
      needsNotification: false,
      needsMultipleSteps: false,
      needsParallel: false,
    },
  };
}

interface DeferredPromise<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): DeferredPromise<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitForUpdate(
  updates: UpdateTaskStatusRequest[],
  predicate: (update: UpdateTaskStatusRequest) => boolean,
  timeoutMs = 5_000,
): Promise<UpdateTaskStatusRequest> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const match = updates.find(predicate);
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for scheduling update: ${JSON.stringify(updates)}`);
}

describe('scheduling execution without silent fallback', () => {
  beforeEach(() => {
    resetSchedulingForTests();
    mockSubmitWorkflow.mockReset();
    mockCancelWorkflow.mockReset();
    mockHandleGenerateWorkflowTool.mockReset();
    mockCancelWorkflowAgentExecution.mockReset();
    mockExecuteWorkflowAgentStep.mockReset();
    mockResolveSchedulingPlan.mockReset();
    mockGetSession.mockReset();
    mockCancelWorkflow.mockResolvedValue(false);
    mockCancelWorkflowAgentExecution.mockResolvedValue(false);
    mockResolveSchedulingPlan.mockImplementation(async (task: Task) => buildWorkflowPlan(task.id));
    mockGetSession.mockImplementation((sessionId: string) => ({
      id: sessionId,
      requested_model: 'claude-sonnet-4-6',
      model: 'claude-sonnet-4-6',
      sdk_cwd: '/tmp/session-workspace',
      working_directory: '/tmp/session-workspace',
    }));
  });

  test('fails the task when workflow validation fails instead of falling back to simple execution', async () => {
    const updates: UpdateTaskStatusRequest[] = [];
    const task = buildTask();

    mockHandleGenerateWorkflowTool.mockReturnValue({
      code: '',
      manifest: {
        dslVersion: 'v1',
        artifactKind: 'workflow-factory-module',
        exportedSymbol: 'buildWorkflow',
        workflowName: 'task-validation-fallback',
        workflowVersion: 'dsl-v1-invalid',
        stepIds: ['main'],
        stepTypes: ['agent'],
        warnings: [],
      },
      validation: {
        valid: false,
        errors: ['steps.main.input.prompt: Required'],
      },
    });
    const submitResult = acceptTask(
      { taskId: task.id, task },
      {
        onTaskStatusUpdate: (update) => {
          updates.push(update);
        },
      },
    );

    expect(submitResult).toMatchObject({
      accepted: true,
      message: 'Task accepted by Scheduling Layer and is waiting for LLM planning',
    });

    const failedUpdate = await waitForUpdate(
      updates,
      (update) => update.status === TaskStatus.FAILED,
    );

    expect(mockSubmitWorkflow).not.toHaveBeenCalled();
    expect(mockExecuteWorkflowAgentStep).not.toHaveBeenCalled();
    expect(failedUpdate.errors).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_VALIDATION_FAILED',
        message: 'steps.main.input.prompt: Required',
      }),
    ]);
    expect(failedUpdate.metadata).toMatchObject({
      scheduling: {
        strategy: 'workflow',
        planner: {
          source: 'llm',
          reason: 'Workflow orchestration is required.',
        },
      },
      workflow: {
        simpleExecutionId: undefined,
        currentStep: undefined,
        completedSteps: [],
      },
    });
  });

  test('runs direct simple execution when the planner selects simple strategy up front', async () => {
    const updates: UpdateTaskStatusRequest[] = [];
    const task = buildTask({
      id: 'task-scheduling-test-004',
      summary: '输出一句简短摘要',
      requirements: ['一句话即可'],
    });

    mockResolveSchedulingPlan.mockResolvedValue(buildSimplePlan());
    mockExecuteWorkflowAgentStep.mockResolvedValue({
      success: true,
      output: {
        summary: '直接执行完成。',
      },
      metadata: {
        workflowRunId: 'simple-task-scheduling-test-004',
        stepId: 'main',
        executionMode: 'synthetic',
      },
    });

    const submitResult = acceptTask(
      { taskId: task.id, task },
      {
        onTaskStatusUpdate: (update) => {
          updates.push(update);
        },
      },
    );

    expect(submitResult).toMatchObject({
      accepted: true,
      message: 'Task accepted by Scheduling Layer and is waiting for LLM planning',
    });

    const completedUpdate = await waitForUpdate(
      updates,
      (update) => update.status === TaskStatus.COMPLETED,
    );

    expect(mockHandleGenerateWorkflowTool).not.toHaveBeenCalled();
    expect(mockSubmitWorkflow).not.toHaveBeenCalled();
    expect(mockExecuteWorkflowAgentStep).toHaveBeenCalledTimes(1);
    expect(mockExecuteWorkflowAgentStep).toHaveBeenCalledWith(expect.objectContaining({
      __runtime: expect.objectContaining({
        taskId: task.id,
        sessionId: task.sessionId,
        requestedModel: 'claude-sonnet-4-6',
        workingDirectory: '/tmp/session-workspace',
      }),
    }));
    expect(completedUpdate.metadata).toMatchObject({
      scheduling: {
        strategy: 'simple',
        planner: {
          source: 'llm',
          reason: 'Task is simple enough for direct execution.',
        },
      },
      workflow: {
        simpleExecutionId: 'simple-task-scheduling-test-004',
        currentAgentRole: undefined,
        completedSteps: ['main'],
        progress: 100,
      },
    });
  });

  test('fails the task when workflow submission is rejected instead of falling back to simple execution', async () => {
    const updates: UpdateTaskStatusRequest[] = [];
    const task = buildTask({ id: 'task-scheduling-test-002' });

    mockHandleGenerateWorkflowTool.mockReturnValue({
      code: 'export function buildWorkflow() {}',
      manifest: {
        dslVersion: 'v1',
        artifactKind: 'workflow-factory-module',
        exportedSymbol: 'buildWorkflow',
        workflowName: 'task-submit-fallback',
        workflowVersion: 'dsl-v1-ok',
        stepIds: ['main'],
        stepTypes: ['agent'],
        warnings: [],
      },
      validation: {
        valid: true,
        errors: [],
      },
    });
    mockSubmitWorkflow.mockResolvedValue({
      workflowId: '',
      status: 'rejected',
      errors: ['engine unavailable'],
    });
    acceptTask(
      { taskId: task.id, task },
      {
        onTaskStatusUpdate: (update) => {
          updates.push(update);
        },
      },
    );

    const failedUpdate = await waitForUpdate(
      updates,
      (update) => update.status === TaskStatus.FAILED,
    );

    expect(mockSubmitWorkflow).toHaveBeenCalledTimes(1);
    expect(mockSubmitWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      inputs: {
        __lumosRuntime: {
          taskId: task.id,
          sessionId: task.sessionId,
          requestedModel: 'claude-sonnet-4-6',
          workingDirectory: '/tmp/session-workspace',
        },
      },
    }), expect.any(Object));
    expect(mockExecuteWorkflowAgentStep).not.toHaveBeenCalled();
    expect(failedUpdate.errors).toEqual([
      expect.objectContaining({
        code: 'WORKFLOW_SUBMISSION_FAILED',
        message: 'engine unavailable',
      }),
    ]);
    expect(failedUpdate.metadata).toMatchObject({
      scheduling: {
        strategy: 'workflow',
        planner: {
          source: 'llm',
        },
      },
      workflow: {
        workflowId: undefined,
        simpleExecutionId: undefined,
        completedSteps: [],
      },
    });
  });

  test('cancelling before llm planning completes stops the accepted task without starting execution', async () => {
    const updates: UpdateTaskStatusRequest[] = [];
    const task = buildTask({ id: 'task-scheduling-test-003' });
    const planningDeferred = createDeferred<SchedulingPlan>();
    mockResolveSchedulingPlan.mockImplementation(() => planningDeferred.promise);

    acceptTask(
      { taskId: task.id, task },
      {
        onTaskStatusUpdate: (update) => {
          updates.push(update);
        },
      },
    );

    await waitForUpdate(
      updates,
      (update) => update.status === TaskStatus.PENDING,
    );

    const cancelResult = await cancelAcceptedTask(task.id);
    expect(cancelResult).toEqual({
      success: true,
      message: 'Task cancelled before workflow submission',
    });
    expect(mockCancelWorkflowAgentExecution).not.toHaveBeenCalled();
    planningDeferred.resolve(buildWorkflowPlan(task.id));

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(updates.some((update) => update.status === TaskStatus.COMPLETED)).toBe(false);
    expect(updates.some((update) => update.status === TaskStatus.RUNNING)).toBe(false);
  });
});
