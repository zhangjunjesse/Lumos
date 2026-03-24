import { TaskStatus, type Task, type TaskError } from '@/lib/task-management/types';
import { cancelWorkflow, submitWorkflow } from '@/lib/workflow/api';
import type {
  WorkflowCompletedEvent,
  WorkflowFailedEvent,
  WorkflowProgressEvent,
} from '@/lib/workflow/engine';
import { handleGenerateWorkflowTool } from '@/lib/workflow/mcp-tool';
import {
  cancelWorkflowAgentExecution,
  executeWorkflowAgentStep,
} from '@/lib/workflow/subagent';
import type { GenerateWorkflowResult } from '@/lib/workflow/types';
import {
  resolveSchedulingPlan,
  SchedulingPlannerError,
  type SchedulingPlan,
  type SchedulingPlanAnalysis,
  type SchedulingPlanDiagnostics,
  type SchedulingPlanSource,
  type SchedulingStrategy,
} from './planner';
import type {
  AcceptTaskRequest,
  AcceptTaskResponse,
  SchedulingCallbacks,
} from './types';
import { getSession } from '@/lib/db/sessions';

const DEFAULT_ESTIMATED_DURATION_SECONDS = 60;
const MAIN_STEP_ID = 'main';
const SIMPLE_EXECUTION_RUN_PREFIX = 'simple';
const SIMPLE_EXECUTION_TIMEOUT_MS = 3 * 60 * 1000;
const PENDING_LLM_REASON = '等待模型规划';

interface SchedulingExecutionState {
  taskId: string;
  cancelled: boolean;
  strategy?: SchedulingStrategy;
  planningSource?: SchedulingPlanSource;
  planningReason?: string;
  planningAnalysis?: SchedulingPlanAnalysis;
  planningModel?: string;
  planningDiagnostics?: SchedulingPlanDiagnostics;
  estimatedDurationSeconds: number;
  workflowDsl?: SchedulingPlan['workflowDsl'];
  artifact?: GenerateWorkflowResult;
  workflowId?: string;
  simpleExecutionId?: string;
  progress: number;
  currentStep?: string;
  completedSteps: string[];
  status: TaskStatus;
}

interface WorkflowRuntimeMetadata {
  taskId: string;
  sessionId?: string;
  requestedModel?: string;
  workingDirectory?: string;
}

const activeExecutions = new Map<string, SchedulingExecutionState>();

export function acceptTask(
  request: AcceptTaskRequest,
  callbacks: SchedulingCallbacks
): AcceptTaskResponse {
  if (activeExecutions.has(request.taskId)) {
    return {
      accepted: false,
      strategy: 'workflow',
      message: `Task is already scheduled: ${request.taskId}`,
    };
  }

  const execution: SchedulingExecutionState = {
    taskId: request.taskId,
    cancelled: false,
    planningSource: 'llm',
    planningReason: PENDING_LLM_REASON,
    estimatedDurationSeconds: DEFAULT_ESTIMATED_DURATION_SECONDS,
    progress: 0,
    completedSteps: [],
    status: TaskStatus.PENDING,
  };

  activeExecutions.set(request.taskId, execution);

  queueMicrotask(() => {
    void runAcceptedTask(request, execution, callbacks);
  });

  return {
    accepted: true,
    message: 'Task accepted by Scheduling Layer and is waiting for LLM planning',
  };
}

export async function cancelAcceptedTask(
  taskId: string,
  workflowIdHint?: string
): Promise<{ success: boolean; message?: string }> {
  const execution = activeExecutions.get(taskId);
  if (execution) {
    execution.cancelled = true;
  }

  const workflowId = execution?.workflowId ?? workflowIdHint;
  if (workflowId) {
    const cancelled = await cancelWorkflow(workflowId);
    if (cancelled) {
      activeExecutions.delete(taskId);
      return {
        success: true,
        message: `Workflow cancellation requested: ${workflowId}`,
      };
    }

    return {
      success: false,
      message: `Workflow is no longer cancellable: ${workflowId}`,
    };
  }

  if (execution) {
    if (execution.strategy === 'simple' && execution.status === TaskStatus.RUNNING) {
      if (execution.simpleExecutionId) {
        try {
          await cancelWorkflowAgentExecution({
            workflowRunId: execution.simpleExecutionId,
            stepId: MAIN_STEP_ID,
          });
        } catch (error) {
          console.error('[Scheduling] Failed to interrupt simple execution:', error);
        }
      }

      activeExecutions.delete(taskId);
      return {
        success: true,
        message: 'Simple execution cancellation requested and any active agent execution was signalled to stop',
      };
    }

    activeExecutions.delete(taskId);
    return {
      success: true,
      message: 'Task cancelled before workflow submission',
    };
  }

  return {
    success: false,
    message: `Task is not scheduled: ${taskId}`,
  };
}

export function resetSchedulingForTests(): void {
  activeExecutions.clear();
}

async function runAcceptedTask(
  request: AcceptTaskRequest,
  execution: SchedulingExecutionState,
  callbacks: SchedulingCallbacks
): Promise<void> {
  emitTaskStatus(callbacks, execution, {
    taskId: request.taskId,
    status: TaskStatus.PENDING,
    progress: 0,
    metadata: buildMetadataSnapshot(execution),
  });

  let resolvedPlan: SchedulingPlan;
  try {
    resolvedPlan = await resolveSchedulingPlan(request.task);
  } catch (error) {
    const failure = toPlanningFailure(error);
    execution.planningSource = 'llm';
    execution.planningReason = failure.message;
    execution.planningDiagnostics = failure.diagnostics;

    failTask(callbacks, execution, [
      {
        code: 'SCHEDULING_PLAN_FAILED',
        message: failure.message,
        details: {
          diagnostics: failure.diagnostics,
        },
      },
    ]);
    return;
  }

  applySchedulingPlan(execution, resolvedPlan);

  emitTaskStatus(callbacks, execution, {
    taskId: request.taskId,
    status: TaskStatus.PENDING,
    progress: 0,
    metadata: buildMetadataSnapshot(execution),
  });

  if (execution.cancelled) {
    activeExecutions.delete(request.taskId);
    return;
  }

  if (resolvedPlan.strategy === 'simple') {
    execution.simpleExecutionId = buildSimpleExecutionId(request.taskId);
    await runSimpleExecution(request, execution, callbacks, {
      simpleExecutionId: execution.simpleExecutionId,
    });
    return;
  }

  if (!execution.workflowDsl) {
    failTask(callbacks, execution, [
      {
        code: 'WORKFLOW_GENERATION_FAILED',
        message: 'Scheduling plan selected workflow but did not provide workflow DSL',
      },
    ]);
    return;
  }

  let artifact: GenerateWorkflowResult;
  try {
    artifact = handleGenerateWorkflowTool({ spec: execution.workflowDsl });
  } catch (error) {
    failTask(callbacks, execution, [
      {
        code: 'WORKFLOW_GENERATION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    ]);
    return;
  }

  execution.artifact = artifact;

  emitTaskStatus(callbacks, execution, {
    taskId: request.taskId,
    status: TaskStatus.PENDING,
    progress: 0,
    metadata: buildMetadataSnapshot(execution),
  });

  if (!artifact.validation.valid) {
    failTask(callbacks, execution, [
      {
        code: 'WORKFLOW_VALIDATION_FAILED',
        message: artifact.validation.errors[0] || 'Workflow validation failed',
        details: {
          validationErrors: artifact.validation.errors,
        },
      },
    ]);
    return;
  }

  if (execution.cancelled) {
    activeExecutions.delete(request.taskId);
    return;
  }

  try {
    const workflowRuntime = resolveWorkflowRuntimeMetadata(request.task);
    const submitResult = await submitWorkflow(
      {
        taskId: request.taskId,
        workflowCode: artifact.code,
        workflowManifest: artifact.manifest,
        inputs: {
          __lumosRuntime: workflowRuntime,
        },
      },
      {
        onProgress: (event) => {
          handleProgressEvent(callbacks, execution, event);
        },
        onCompleted: (event) => {
          handleCompletedEvent(callbacks, execution, event);
        },
        onFailed: (event) => {
          handleFailedEvent(callbacks, execution, event);
        },
      }
    );

    if (submitResult.status !== 'accepted') {
      failTask(callbacks, execution, [
        {
          code: 'WORKFLOW_SUBMISSION_FAILED',
          message: submitResult.errors?.[0] || 'Workflow submission rejected',
          details: {
            submissionErrors: submitResult.errors ?? [],
          },
        },
      ]);
      return;
    }

    execution.workflowId = submitResult.workflowId;

    if (execution.cancelled) {
      await cancelWorkflow(submitResult.workflowId);
      activeExecutions.delete(request.taskId);
    }
  } catch (error) {
    failTask(callbacks, execution, [
      {
        code: 'WORKFLOW_SUBMISSION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    ]);
  }
}

function handleProgressEvent(
  callbacks: SchedulingCallbacks,
  execution: SchedulingExecutionState,
  event: WorkflowProgressEvent
): void {
  if (execution.cancelled) {
    return;
  }

  execution.workflowId = event.workflowId;
  execution.progress = event.progress;
  execution.currentStep = event.currentStep;
  execution.completedSteps = event.completedSteps;
  execution.status = TaskStatus.RUNNING;

  emitTaskStatus(callbacks, execution, {
    taskId: execution.taskId,
    status: TaskStatus.RUNNING,
    progress: event.progress,
    metadata: buildMetadataSnapshot(execution),
  });
}

function handleCompletedEvent(
  callbacks: SchedulingCallbacks,
  execution: SchedulingExecutionState,
  event: WorkflowCompletedEvent
): void {
  if (execution.cancelled) {
    activeExecutions.delete(execution.taskId);
    return;
  }

  execution.workflowId = event.workflowId;
  execution.progress = 100;
  execution.currentStep = undefined;
  execution.completedSteps = execution.artifact?.manifest.stepIds ?? execution.completedSteps;
  execution.status = TaskStatus.COMPLETED;

  emitTaskStatus(callbacks, execution, {
    taskId: execution.taskId,
    status: TaskStatus.COMPLETED,
    progress: 100,
    result: {
      workflowId: event.workflowId,
      durationMs: event.duration,
      outputs: event.result,
    },
    metadata: buildMetadataSnapshot(execution, {
      durationMs: event.duration,
    }),
  });

  activeExecutions.delete(execution.taskId);
}

function handleFailedEvent(
  callbacks: SchedulingCallbacks,
  execution: SchedulingExecutionState,
  event: WorkflowFailedEvent
): void {
  if (execution.cancelled) {
    activeExecutions.delete(execution.taskId);
    return;
  }

  execution.workflowId = event.workflowId;
  execution.currentStep = undefined;
  execution.status = TaskStatus.FAILED;

  failTask(callbacks, execution, [
    {
      code: event.error.code,
      message: event.error.message,
      details: {
        stepName: event.error.stepName,
      },
    },
  ]);
}

function failTask(
  callbacks: SchedulingCallbacks,
  execution: SchedulingExecutionState,
  errors: TaskError[]
): void {
  execution.status = TaskStatus.FAILED;

  emitTaskStatus(callbacks, execution, {
    taskId: execution.taskId,
    status: TaskStatus.FAILED,
    progress: execution.progress,
    errors,
    metadata: buildMetadataSnapshot(execution),
  });

  activeExecutions.delete(execution.taskId);
}

async function runSimpleExecution(
  request: AcceptTaskRequest,
  execution: SchedulingExecutionState,
  callbacks: SchedulingCallbacks,
  options: {
    simpleExecutionId: string;
  },
): Promise<void> {
  const workflowRuntime = resolveWorkflowRuntimeMetadata(request.task);
  execution.currentStep = MAIN_STEP_ID;
  execution.completedSteps = [];
  execution.progress = 0;
  execution.status = TaskStatus.RUNNING;

  emitTaskStatus(callbacks, execution, {
    taskId: execution.taskId,
    status: TaskStatus.RUNNING,
    progress: 0,
    metadata: buildMetadataSnapshot(execution),
  });

  const result = await executeWorkflowAgentStep({
    prompt: buildTaskPrompt(request.task),
    role: 'worker',
    __runtime: {
      workflowRunId: options.simpleExecutionId,
      stepId: MAIN_STEP_ID,
      stepType: 'agent',
      timeoutMs: SIMPLE_EXECUTION_TIMEOUT_MS,
      taskId: workflowRuntime.taskId,
      ...(workflowRuntime.sessionId ? { sessionId: workflowRuntime.sessionId } : {}),
      ...(workflowRuntime.requestedModel ? { requestedModel: workflowRuntime.requestedModel } : {}),
      ...(workflowRuntime.workingDirectory ? { workingDirectory: workflowRuntime.workingDirectory } : {}),
    },
  });

  if (execution.cancelled) {
    activeExecutions.delete(request.taskId);
    return;
  }

  if (!result.success) {
    failTask(callbacks, execution, [
      {
        code: 'SIMPLE_EXECUTION_FAILED',
        message: result.error || 'Simple execution failed',
        details: {
          stepId: MAIN_STEP_ID,
          simpleExecutionId: options.simpleExecutionId,
          metadata: result.metadata,
        },
      },
    ]);
    return;
  }

  execution.progress = 100;
  execution.currentStep = undefined;
  execution.completedSteps = [MAIN_STEP_ID];
  execution.status = TaskStatus.COMPLETED;

  emitTaskStatus(callbacks, execution, {
    taskId: execution.taskId,
    status: TaskStatus.COMPLETED,
    progress: 100,
    result: {
      mode: 'simple',
      simpleExecutionId: options.simpleExecutionId,
      outputs: {
        [MAIN_STEP_ID]: result,
      },
    },
    metadata: buildMetadataSnapshot(execution),
  });

  activeExecutions.delete(execution.taskId);
}

function emitTaskStatus(
  callbacks: SchedulingCallbacks,
  execution: SchedulingExecutionState,
  request: {
    taskId: string;
    status: TaskStatus;
    progress?: number;
    result?: unknown;
    errors?: TaskError[];
    metadata?: Record<string, unknown>;
  }
): void {
  execution.status = request.status;
  if (request.progress !== undefined) {
    execution.progress = request.progress;
  }
  callbacks.onTaskStatusUpdate(request);
}

function applySchedulingPlan(
  execution: SchedulingExecutionState,
  plan: SchedulingPlan,
): void {
  execution.strategy = plan.strategy;
  execution.planningSource = plan.source;
  execution.planningReason = plan.reason;
  execution.planningAnalysis = plan.analysis;
  execution.planningModel = plan.model;
  execution.planningDiagnostics = plan.diagnostics;
  execution.estimatedDurationSeconds = plan.estimatedDurationSeconds;
  execution.workflowDsl = plan.workflowDsl;
}

function buildSimpleExecutionId(taskId: string): string {
  return `${SIMPLE_EXECUTION_RUN_PREFIX}-${taskId}`;
}

function resolveWorkflowRuntimeMetadata(task: Task): WorkflowRuntimeMetadata {
  const session = getSession(task.sessionId);
  const sessionId = task.sessionId?.trim() || '';
  const requestedModel = (session?.requested_model || session?.model || '').trim() || undefined;
  const workingDirectory = (session?.sdk_cwd || session?.working_directory || '').trim() || undefined;

  return {
    taskId: task.id,
    ...(sessionId ? { sessionId } : {}),
    ...(requestedModel ? { requestedModel } : {}),
    ...(workingDirectory ? { workingDirectory } : {}),
  };
}

function buildTaskPrompt(task: Task): string {
  const lines: string[] = [
    `任务: ${task.summary}`,
  ];

  if (task.requirements.length > 0) {
    lines.push('要求:');
    for (const requirement of task.requirements) {
      lines.push(`- ${requirement}`);
    }
  }

  const relevantMessages = Array.isArray(task.metadata?.relevantMessages)
    ? (task.metadata?.relevantMessages as unknown[])
        .filter((message): message is string => typeof message === 'string' && message.trim().length > 0)
    : [];

  if (relevantMessages.length > 0) {
    lines.push('相关上下文:');
    for (const message of relevantMessages) {
      lines.push(`- ${message}`);
    }
  }

  lines.push('请直接完成任务，并返回最终结果。');

  return lines.join('\n');
}

function resolveCurrentExecutionRole(execution: SchedulingExecutionState): string | undefined {
  if (!execution.currentStep) {
    return undefined;
  }

  if (execution.currentStep === MAIN_STEP_ID && execution.strategy === 'simple') {
    return 'worker';
  }

  const currentStep = execution.workflowDsl?.steps.find((step) => step.id === execution.currentStep);
  if (!currentStep) {
    return undefined;
  }

  if (currentStep.type === 'agent') {
    const rawRole = currentStep.input?.role;
    if (typeof rawRole === 'string' && rawRole.trim().length > 0) {
      return rawRole.trim();
    }
    return 'worker';
  }

  return currentStep.type;
}

function buildMetadataSnapshot(
  execution: SchedulingExecutionState,
  extras?: {
    durationMs?: number;
  }
): Record<string, unknown> {
  const plannerInfo = execution.planningSource || execution.planningReason || execution.planningAnalysis || execution.planningModel || execution.planningDiagnostics
    ? {
        source: execution.planningSource,
        reason: execution.planningReason,
        analysis: execution.planningAnalysis,
        model: execution.planningModel,
        diagnostics: execution.planningDiagnostics,
      }
    : undefined;

  return {
    scheduling: {
      strategy: execution.strategy,
      generator: execution.planningSource === 'llm'
        ? 'llm-planner'
        : execution.planningSource === 'heuristic'
          ? 'heuristic-planner'
          : undefined,
      planner: plannerInfo,
      workflowDsl: execution.workflowDsl,
      validation: execution.artifact?.validation,
      workflowManifest: execution.artifact?.manifest,
      estimatedDurationSeconds: execution.estimatedDurationSeconds,
    },
    workflow: {
      workflowId: execution.workflowId,
      simpleExecutionId: execution.simpleExecutionId,
      status: execution.status,
      progress: execution.progress,
      currentStep: execution.currentStep,
      currentAgentRole: resolveCurrentExecutionRole(execution),
      completedSteps: execution.completedSteps,
      durationMs: extras?.durationMs,
    },
  };
}

function toPlanningFailure(error: unknown): {
  message: string;
  diagnostics?: SchedulingPlanDiagnostics;
} {
  if (error instanceof SchedulingPlannerError) {
    return {
      message: error.message,
      diagnostics: error.diagnostics,
    };
  }

  return {
    message: error instanceof Error ? error.message : String(error),
  };
}
