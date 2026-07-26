import { createHash } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { type OpenWorkflow, type Worker, type Workflow } from 'openworkflow';
import { loadCompiledWorkflowModule } from './compiled-module-loader';
import {
  clearWorkflowProjectionTables,
  completeWorkflowProjection,
  failWorkflowProjection,
  getWorkflowProjection,
  initializeWorkflowProjection,
  markWorkflowRunning,
  markWorkflowStepCompleted,
  markWorkflowStepSkipped,
  markWorkflowStepStarted,
  persistWorkflowDefinition,
  persistWorkflowTaskMapping,
  cancelWorkflowProjection,
  type WorkflowProjection,
} from './projection';
import {
  getWorkflowEngine,
  resetWorkflowClientForTests,
} from './openworkflow-client';
import {
  insertRunStep,
  setRunStepOutputSummary,
  updateRunStep,
} from '@/lib/db/schedule-run-steps';
import { DEFAULT_AGENT_STEP_TIMEOUT_MS } from './compiler-helpers';
import { createInstrumentedWorkflowRuntimeBindings } from './runtime';
import { clearDebugContext, isReusedDebugStep, registerDebugContext } from './debug-cache';
import { clearRunAttempts, clearStepAttempt, recordStepAttempt } from './step-attempts';
import { getSupportedStepTypes } from './step-registry';
import { cancelWorkflowAgentExecution } from './subagent';
import { taskEventBus } from '@/lib/task-event-bus';
import type { DebugRuntimeContext } from './debug-types';
import type {
  CompiledWorkflowManifest,
  SubmitWorkflowRequest,
  SubmitWorkflowResponse,
  WorkflowExecutionStatus,
  WorkflowStatusResponse,
} from './types';

// 回调接口
export interface WorkflowCallbacks {
  onProgress?: (event: WorkflowProgressEvent) => void;
  onCompleted?: (event: WorkflowCompletedEvent) => void;
  onFailed?: (event: WorkflowFailedEvent) => void;
}

export interface WorkflowProgressEvent {
  workflowId: string;
  taskId: string;
  progress: number;
  currentStep?: string;
  completedSteps: string[];
}

export interface WorkflowCompletedEvent {
  workflowId: string;
  taskId: string;
  result: unknown;
  duration: number;
}

export interface WorkflowFailedEvent {
  workflowId: string;
  taskId: string;
  error: {
    code: string;
    message: string;
    stepName?: string;
  };
}

const MIN_WORKFLOW_RESULT_TIMEOUT_MS = 15 * 60 * 1000;
const WORKFLOW_RESULT_TIMEOUT_GRACE_MS = 2 * 60 * 1000;
const registeredWorkflows = new Set<string>();
const supportedStepTypes = new Set<string>([
  ...getSupportedStepTypes(),
  // Control-flow node types — emitted by compiler-v3, not backed by the step registry
  'if-else', 'for-each', 'while', 'parallel', 'join', 'approval',
]);
let globalWorker: Worker | null = null;

function computeWorkflowTimeout(manifest: CompiledWorkflowManifest): number {
  // #15: Honor DSL-level maxDurationMs when set
  if (typeof manifest.maxDurationMs === 'number' && Number.isFinite(manifest.maxDurationMs) && manifest.maxDurationMs > 0) {
    return manifest.maxDurationMs + WORKFLOW_RESULT_TIMEOUT_GRACE_MS;
  }

  const declaredStepTimeouts = Array.isArray(manifest.stepTimeoutsMs)
    ? manifest.stepTimeoutsMs.filter((timeoutMs): timeoutMs is number => (
      typeof timeoutMs === 'number'
      && Number.isFinite(timeoutMs)
      && timeoutMs > 0
    ))
    : [];
  const fallbackStepCount = manifest.stepIds.length || 1;
  const baseTimeoutMs = declaredStepTimeouts.length > 0
    ? declaredStepTimeouts.reduce((total, timeoutMs) => total + timeoutMs, 0)
    : fallbackStepCount * DEFAULT_AGENT_STEP_TIMEOUT_MS;
  return Math.max(baseTimeoutMs, MIN_WORKFLOW_RESULT_TIMEOUT_MS) + WORKFLOW_RESULT_TIMEOUT_GRACE_MS;
}

interface WorkflowExecutionState {
  taskId: string;
  runHistoryId?: string | null;
  status: WorkflowExecutionStatus;
  progress: number;
  currentStep?: string;
  completedSteps: string[];
  result?: unknown;
  error?: unknown;
  workflowManifest: CompiledWorkflowManifest;
  callbacks?: WorkflowCallbacks;
  runHandle?: {
    result: (options?: { timeoutMs?: number }) => Promise<unknown>;
  };
  cancellationRequested?: boolean;
  completedAt?: number;
}

const workflowExecutions = new Map<string, WorkflowExecutionState>();

const workflowExecutionGcTimer = setInterval(() => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  for (const [id, execution] of workflowExecutions.entries()) {
    if (execution.completedAt && now - execution.completedAt > oneHour) {
      workflowExecutions.delete(id);
    }
  }
}, 10 * 60 * 1000); // 每10分钟清理一次

workflowExecutionGcTimer.unref?.();

/**
 * Step 并发上限。每个 agent step 对应一个 Claude Agent SDK CLI 子进程,
 * 单进程 ≈ 200-300MB。按 64GB 机器留出系统/Electron 开销保守估算,~200 个
 * 子进程仍在内存安全线内,所以默认放到 200 让用户尽量不被节流;觉得卡就
 * 自己错开任务。可通过 env LUMOS_WORKFLOW_CONCURRENCY 覆盖,clamp 到
 * [1, 500],防手抖把数字写离谱。
 */
function resolveWorkflowConcurrency(): number {
  const DEFAULT = 200;
  const HARD_MAX = 500;
  const raw = process.env.LUMOS_WORKFLOW_CONCURRENCY;
  if (!raw) return DEFAULT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT;
  return Math.min(parsed, HARD_MAX);
}

// 获取或创建 Worker
async function getOrCreateWorker(
  ow: OpenWorkflow,
  restartIfRunning = false
): Promise<Worker> {
  if (restartIfRunning && globalWorker) {
    await globalWorker.stop();
    globalWorker = null;
  }

  if (!globalWorker) {
    globalWorker = ow.newWorker({ concurrency: resolveWorkflowConcurrency() });
    await globalWorker.start();
  }
  return globalWorker;
}

// 关闭 Worker
export async function shutdownWorker() {
  if (globalWorker) {
    await globalWorker.stop();
    globalWorker = null;
  }
}

/** team 步骤输出带 dispatches 时,在摘要前加一行派单脉络;其他步骤返回空串。 */
function buildDispatchPrefix(record: Record<string, unknown>): string {
  const dispatches = record.dispatches;
  if (typeof dispatches !== 'number') return '';
  const to = Array.isArray(record.dispatched_to) ? record.dispatched_to.filter(x => typeof x === 'string') : [];
  const roster = to.length > 0 ? ` → ${to.join('、')}` : '';
  return `[派单 ${dispatches} 次${roster}]\n\n`;
}

function summarizeWorkflowStepOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output.trim();
  }
  if (typeof output === 'number' || typeof output === 'boolean') {
    return String(output);
  }
  if (!output || typeof output !== 'object') {
    return '';
  }
  const record = output as Record<string, unknown>;
  for (const key of ['summary', 'message', 'text', 'content', 'result']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      // team 步骤:摘要里带上派单脉络。否则详情页只看到交付文本,
      // 「这一步到底有没有真派单」这个关键信息在 UI 上完全消失。
      const dispatchPrefix = buildDispatchPrefix(record);
      return `${dispatchPrefix}${candidate.trim()}`;
    }
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

export async function submitWorkflow(
  request: SubmitWorkflowRequest,
  callbacks?: WorkflowCallbacks,
  debugContext?: DebugRuntimeContext | null,
): Promise<SubmitWorkflowResponse> {
  const manifestErrors = validateCompiledWorkflowManifest(request.workflowManifest);
  if (manifestErrors.length > 0) {
    return {
      workflowId: '',
      status: 'rejected',
      errors: manifestErrors,
    };
  }

  try {
    const ow = await getWorkflowEngine();

    const workflow = await loadWorkflowDefinition(
      request.workflowCode,
      request.workflowManifest,
    );
    const registered = ensureWorkflowRegistered(ow, workflow);
    await getOrCreateWorker(ow, registered);

    const runHandle = await ow.runWorkflow(workflow.spec, request.inputs);
    const workflowId = runHandle.workflowRun.id;

    // Debug state is per-run; bind it here AFTER we know the runId and BEFORE
    // any step fires. The step bindings resolve it on each call via
    // `input.__runtime.workflowRunId`, and `waitForWorkflowCompletion` clears
    // the registration in its finally block.
    if (debugContext) {
      registerDebugContext(workflowId, debugContext);
    }

    persistWorkflowDefinition(request.workflowManifest, request.workflowCode);
    persistWorkflowTaskMapping(request.workflowManifest, request.taskId, workflowId);
    const projection = initializeWorkflowProjection(workflowId, request.taskId, request.workflowManifest);

    workflowExecutions.set(workflowId, {
      taskId: request.taskId,
      runHistoryId: request.runHistoryId ?? null,
      status: 'pending',
      progress: 0,
      completedSteps: [],
      workflowManifest: request.workflowManifest,
      callbacks,
      runHandle,
    });
    syncExecutionStateFromProjection(projection);
    emitProgressFromProjection(projection);

    void waitForWorkflowCompletion(
      workflowId,
      request.taskId,
      runHandle,
      request.timeoutMs ?? computeWorkflowTimeout(request.workflowManifest),
      callbacks
    );

    return { workflowId, status: 'accepted' };
  } catch (error: unknown) {
    console.error('Failed to submit workflow:', error);
    return {
      workflowId: '',
      status: 'rejected',
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function loadWorkflowDefinition(
  code: string,
  manifest: CompiledWorkflowManifest,
): Promise<Workflow<unknown, unknown, unknown>> {
  if (!code.trim()) {
    throw new Error('Compiled workflow code is empty');
  }

  const tempDir = path.join(process.cwd(), 'node_modules', '.cache', 'compiled-workflows');
  const fileName = `${sanitizeFileSegment(manifest.workflowName)}-${manifest.workflowVersion}.mjs`;
  const filePath = path.join(tempDir, fileName);
  const cacheBust = createHash('sha256').update(code).digest('hex');

  await mkdir(tempDir, { recursive: true });
  await writeFile(filePath, code, 'utf-8');

  const moduleUrl = `${pathToFileURL(filePath).href}?v=${cacheBust}`;
  const workflowModule = await loadCompiledWorkflowModule(moduleUrl, filePath);
  const buildWorkflow = workflowModule[manifest.exportedSymbol];

  if (typeof buildWorkflow !== 'function') {
    throw new Error(`Compiled workflow module is missing export "${manifest.exportedSymbol}"`);
  }

  const workflow = buildWorkflow(createInstrumentedWorkflowRuntimeBindings({
    onStepStarted: async (event) => {
      const runHistoryId = workflowExecutions.get(event.workflowRunId)?.runHistoryId;
      const reusedStep = isReusedDebugStep(event.workflowRunId, event.stepId);
      if (runHistoryId && !reusedStep) {
        insertRunStep(runHistoryId, event.stepId);
      }
      if (!reusedStep) {
        recordStepAttempt(event.workflowRunId, event.stepId, event.attempt, event.maxAttempts);
      }
      const projection = markWorkflowStepStarted(event.workflowRunId, event.stepId);
      if (projection) {
        syncExecutionStateFromProjection(projection);
        emitProgressFromProjection(projection);
      }
    },
    onStepOutput: async (event) => {
      const runHistoryId = workflowExecutions.get(event.workflowRunId)?.runHistoryId;
      if (runHistoryId && !isReusedDebugStep(event.workflowRunId, event.stepId)) {
        const summary = summarizeWorkflowStepOutput(event.output);
        if (summary) {
          setRunStepOutputSummary(runHistoryId, event.stepId, summary);
        }
      }
    },
    onStepCompleted: async (event) => {
      const runHistoryId = workflowExecutions.get(event.workflowRunId)?.runHistoryId;
      if (runHistoryId && !isReusedDebugStep(event.workflowRunId, event.stepId)) {
        updateRunStep(runHistoryId, event.stepId, 'success');
      }
      clearStepAttempt(event.workflowRunId, event.stepId);
      const projection = markWorkflowStepCompleted(event.workflowRunId, event.stepId);
      if (projection) {
        syncExecutionStateFromProjection(projection);
        emitProgressFromProjection(projection);
      }
    },
    onStepSkipped: async (event) => {
      const runHistoryId = workflowExecutions.get(event.workflowRunId)?.runHistoryId;
      if (runHistoryId && !isReusedDebugStep(event.workflowRunId, event.stepId)) {
        insertRunStep(runHistoryId, event.stepId);
        updateRunStep(runHistoryId, event.stepId, 'skipped');
      }
      const projection = markWorkflowStepSkipped(event.workflowRunId, event.stepId);
      if (projection) {
        syncExecutionStateFromProjection(projection);
        emitProgressFromProjection(projection);
      }
    },
  }));
  if (!isWorkflowDefinition(workflow)) {
    throw new Error('buildWorkflow did not return a Workflow object');
  }

  if (
    workflow.spec.name !== manifest.workflowName ||
    workflow.spec.version !== manifest.workflowVersion
  ) {
    throw new Error('Compiled workflow manifest does not match workflow spec');
  }

  return workflow;
}

async function waitForWorkflowCompletion(
  workflowId: string,
  taskId: string,
  runHandle: {
    result: (options?: { timeoutMs?: number }) => Promise<unknown>;
  },
  timeoutMs: number,
  callbacks?: WorkflowCallbacks
) {
  const startTime = Date.now();

  const runningProjection = markWorkflowRunning(workflowId);
  if (runningProjection) {
    syncExecutionStateFromProjection(runningProjection);
    emitProgressFromProjection(runningProjection);
  }

  try {
    const result = await runHandle.result({ timeoutMs });
    const currentExecution = workflowExecutions.get(workflowId);
    if (currentExecution?.status === 'cancelled' || currentExecution?.cancellationRequested) {
      return;
    }

    const duration = Date.now() - startTime;
    clearRunAttempts(workflowId);
    const completedProjection = completeWorkflowProjection(workflowId, result);

    workflowExecutions.set(workflowId, {
      ...workflowExecutions.get(workflowId)!,
      status: 'completed',
      progress: 100,
      currentStep: undefined,
      completedSteps: completedProjection?.completedSteps ?? workflowExecutions.get(workflowId)?.completedSteps ?? [],
      result,
      completedAt: Date.now(),
    });
    if (completedProjection) {
      syncExecutionStateFromProjection(completedProjection);
    }

    callbacks?.onCompleted?.({
      workflowId,
      taskId,
      result,
      duration
    });

  } catch (error: unknown) {
    const currentExecution = workflowExecutions.get(workflowId);
    if (currentExecution?.status === 'cancelled' || currentExecution?.cancellationRequested) {
      return;
    }

    const err = error as Record<string, unknown> | Error | null;
    const failure = {
      code: (err && typeof err === 'object' && 'code' in err ? String(err.code) : undefined) || 'WORKFLOW_FAILED',
      message: error instanceof Error ? error.message : String(error),
      stepName: err && typeof err === 'object' && 'stepName' in err ? String(err.stepName) : undefined,
    };
    clearRunAttempts(workflowId);
    const runHistoryId = currentExecution?.runHistoryId;
    if (runHistoryId && failure.stepName) {
      insertRunStep(runHistoryId, failure.stepName);
      updateRunStep(runHistoryId, failure.stepName, 'error', failure.message);
    }
    const failedProjection = failWorkflowProjection(workflowId, failure);

    workflowExecutions.set(workflowId, {
      ...currentExecution!,
      status: 'failed',
      progress: failedProjection?.progress ?? currentExecution?.progress ?? 0,
      currentStep: undefined,
      completedSteps: failedProjection?.completedSteps ?? currentExecution?.completedSteps ?? [],
      error: failure,
      completedAt: Date.now(),
    });
    if (failedProjection) {
      syncExecutionStateFromProjection(failedProjection);
    }

    callbacks?.onFailed?.({
      workflowId,
      taskId,
      error: failure
    });
  } finally {
    // Always release the per-run debug registration so the next run of this
    // spec (debug or production) starts from a clean slate.
    clearDebugContext(workflowId);
  }
}

function ensureWorkflowRegistered(
  ow: OpenWorkflow,
  workflow: Workflow<unknown, unknown, unknown>
): boolean {
  const key = getWorkflowRegistryKey(workflow);
  if (registeredWorkflows.has(key)) {
    return false;
  }

  ow.implementWorkflow(workflow.spec, workflow.fn);
  registeredWorkflows.add(key);
  return true;
}

function getWorkflowRegistryKey(workflow: Workflow<unknown, unknown, unknown>): string {
  return workflow.spec.version
    ? `${workflow.spec.name}@${workflow.spec.version}`
    : workflow.spec.name;
}

function validateCompiledWorkflowManifest(manifest: CompiledWorkflowManifest): string[] {
  const errors: string[] = [];

  if (manifest.dslVersion !== 'v3') {
    errors.push(`Unsupported DSL version: ${manifest.dslVersion}`);
  }

  if (manifest.artifactKind !== 'workflow-factory-module') {
    errors.push(`Unsupported artifact kind: ${manifest.artifactKind}`);
  }

  if (manifest.exportedSymbol !== 'buildWorkflow') {
    errors.push(`Unsupported workflow export: ${manifest.exportedSymbol}`);
  }

  if (!manifest.workflowName) {
    errors.push('Workflow manifest is missing workflowName');
  }

  if (!manifest.workflowVersion) {
    errors.push('Workflow manifest is missing workflowVersion');
  }

  if (!Array.isArray(manifest.stepIds) || manifest.stepIds.length === 0) {
    errors.push('Workflow manifest is missing stepIds');
  }

  for (const stepType of manifest.stepTypes) {
    if (!supportedStepTypes.has(stepType)) {
      errors.push(`Manifest references unsupported step type "${stepType}"`);
    }
  }

  return errors;
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, '_');
}

function isWorkflowDefinition(value: unknown): value is Workflow<unknown, unknown, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.fn !== 'function') {
    return false;
  }

  if (typeof candidate.spec !== 'object' || candidate.spec === null) {
    return false;
  }

  const spec = candidate.spec as Record<string, unknown>;
  return typeof spec.name === 'string';
}

export async function getWorkflowStatus(
  workflowId: string
): Promise<WorkflowStatusResponse | null> {
  const projection = getWorkflowProjection(workflowId);
  if (projection) {
    syncExecutionStateFromProjection(projection);
    return {
      status: projection.status,
      progress: projection.progress,
      currentStep: projection.currentStep,
      completedSteps: projection.completedSteps,
      result: projection.result,
      error: projection.error,
    };
  }

  const execution = workflowExecutions.get(workflowId);
  if (!execution) {
    return null;
  }
  return {
    status: execution.status,
    progress: execution.progress,
    currentStep: execution.currentStep,
    completedSteps: execution.completedSteps,
    result: execution.result,
    error: execution.error
  };
}

export async function cancelWorkflow(workflowId: string): Promise<boolean> {
  const projection = getWorkflowProjection(workflowId);
  const execution = workflowExecutions.get(workflowId);
  const status = execution?.status ?? projection?.status;
  if (
    !status ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled'
  ) {
    return false;
  }

  if (execution) {
    workflowExecutions.set(workflowId, {
      ...execution,
      cancellationRequested: true,
    });
  }

  try {
    await cancelWorkflowAgentExecution({ workflowRunId: workflowId });
  } catch (error) {
    console.error(`[WorkflowEngine] Failed to interrupt agent steps for workflow ${workflowId}:`, error);
  }

  const ow = await getWorkflowEngine();
  await ow.cancelWorkflowRun(workflowId);
  clearRunAttempts(workflowId);
  const cancelledProjection = cancelWorkflowProjection(workflowId);

  if (execution) {
    workflowExecutions.set(workflowId, {
      ...workflowExecutions.get(workflowId)!,
      status: 'cancelled',
      progress: cancelledProjection?.progress ?? execution.progress,
      currentStep: undefined,
      completedSteps: cancelledProjection?.completedSteps ?? execution.completedSteps,
      error: { code: 'WORKFLOW_CANCELLED', message: 'Cancelled by user' },
      completedAt: Date.now()
    });
  }
  if (cancelledProjection) {
    syncExecutionStateFromProjection(cancelledProjection);
  }

  return true;
}

export async function resetWorkflowEngineForTests(): Promise<void> {
  await shutdownWorker();
  workflowExecutions.clear();
  registeredWorkflows.clear();
  clearWorkflowProjectionTables();
  await resetWorkflowClientForTests();
}

export function __testOnlyPrimeWorkflowExecution(input: {
  workflowId: string;
  taskId: string;
  workflowManifest: CompiledWorkflowManifest;
  callbacks?: WorkflowCallbacks;
  runHandle?: {
    result: (options?: { timeoutMs?: number }) => Promise<unknown>;
  };
}): void {
  const projection = initializeWorkflowProjection(
    input.workflowId,
    input.taskId,
    input.workflowManifest
  );

  workflowExecutions.set(input.workflowId, {
    taskId: input.taskId,
    status: 'pending',
    progress: 0,
    completedSteps: [],
    workflowManifest: input.workflowManifest,
    callbacks: input.callbacks,
    runHandle: input.runHandle,
  });

  syncExecutionStateFromProjection(projection);
}

export async function __testOnlyObserveWorkflowCompletion(input: {
  workflowId: string;
  taskId: string;
  runHandle: {
    result: (options?: { timeoutMs?: number }) => Promise<unknown>;
  };
  timeoutMs?: number;
  callbacks?: WorkflowCallbacks;
}): Promise<void> {
  await waitForWorkflowCompletion(
    input.workflowId,
    input.taskId,
    input.runHandle,
    input.timeoutMs ?? MIN_WORKFLOW_RESULT_TIMEOUT_MS,
    input.callbacks
  );
}

function syncExecutionStateFromProjection(projection: WorkflowProjection): void {
  const current = workflowExecutions.get(projection.workflowId);
  if (!current) {
    return;
  }

  workflowExecutions.set(projection.workflowId, {
    ...current,
    status: projection.status,
    progress: projection.progress,
    currentStep: projection.currentStep,
    completedSteps: projection.completedSteps,
    result: projection.result,
    error: projection.error,
  });
}

function emitProgressFromProjection(projection: WorkflowProjection): void {
  const execution = workflowExecutions.get(projection.workflowId);

  // #10: Emit step-level progress via taskEventBus for real-time UI updates
  try {
    taskEventBus.emitGlobalEvent({
      type: 'workflow:progress',
      data: {
        workflowId: projection.workflowId,
        taskId: projection.taskId,
        status: projection.status,
        progress: projection.progress,
        currentStep: projection.currentStep,
        completedSteps: projection.completedSteps,
      },
    });
  } catch (e) {
    console.warn('[workflow] taskEventBus emit failed:', e instanceof Error ? e.message : e);
  }

  if (!execution?.callbacks?.onProgress) {
    return;
  }

  execution.callbacks.onProgress({
    workflowId: projection.workflowId,
    taskId: projection.taskId,
    progress: projection.progress,
    currentStep: projection.currentStep,
    completedSteps: projection.completedSteps,
  });
}
