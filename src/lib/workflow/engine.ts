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
import { createInstrumentedWorkflowRuntimeBindings } from './runtime';
import { getSupportedStepTypes } from './step-registry';
import { cancelWorkflowAgentExecution } from './subagent';
import type {
  CompiledWorkflowManifest,
  SubmitWorkflowRequest,
  SubmitWorkflowResponse,
  WorkflowExecutionStatus,
  WorkflowFactoryModule,
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
  result: any;
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

const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1000;
const MIN_WORKFLOW_RESULT_TIMEOUT_MS = 15 * 60 * 1000;
const registeredWorkflows = new Set<string>();
const supportedStepTypes = new Set([
  ...getSupportedStepTypes(),
  // v2 control-flow step types — handled by compiler-v2, not the step registry
  'if-else', 'for-each', 'while',
]);
let globalWorker: Worker | null = null;

function computeWorkflowTimeout(manifest: CompiledWorkflowManifest): number {
  const stepCount = manifest.stepIds.length || 1;
  return Math.max(stepCount * DEFAULT_STEP_TIMEOUT_MS, MIN_WORKFLOW_RESULT_TIMEOUT_MS);
}

interface WorkflowExecutionState {
  taskId: string;
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
    globalWorker = ow.newWorker({ concurrency: 5 });
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

export async function submitWorkflow(
  request: SubmitWorkflowRequest,
  callbacks?: WorkflowCallbacks
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
      request.workflowManifest
    );
    const registered = ensureWorkflowRegistered(ow, workflow);
    await getOrCreateWorker(ow, registered);

    const runHandle = await ow.runWorkflow(workflow.spec, request.inputs);
    const workflowId = runHandle.workflowRun.id;

    persistWorkflowDefinition(request.workflowManifest, request.workflowCode);
    persistWorkflowTaskMapping(request.workflowManifest, request.taskId, workflowId);
    const projection = initializeWorkflowProjection(workflowId, request.taskId, request.workflowManifest);

    workflowExecutions.set(workflowId, {
      taskId: request.taskId,
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
  } catch (error: any) {
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
  manifest: CompiledWorkflowManifest
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
  const module = await loadCompiledWorkflowModule(moduleUrl, filePath);
  const buildWorkflow = module[manifest.exportedSymbol];

  if (typeof buildWorkflow !== 'function') {
    throw new Error(`Compiled workflow module is missing export "${manifest.exportedSymbol}"`);
  }

  const workflow = buildWorkflow(createInstrumentedWorkflowRuntimeBindings({
    onStepStarted: async (event) => {
      const projection = markWorkflowStepStarted(event.workflowRunId, event.stepId);
      if (projection) {
        syncExecutionStateFromProjection(projection);
        emitProgressFromProjection(projection);
      }
    },
    onStepCompleted: async (event) => {
      const projection = markWorkflowStepCompleted(event.workflowRunId, event.stepId);
      if (projection) {
        syncExecutionStateFromProjection(projection);
        emitProgressFromProjection(projection);
      }
    },
    onStepSkipped: async (event) => {
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

  } catch (error: any) {
    const currentExecution = workflowExecutions.get(workflowId);
    if (currentExecution?.status === 'cancelled' || currentExecution?.cancellationRequested) {
      return;
    }

    const failure = {
      code: error?.code || 'WORKFLOW_FAILED',
      message: error instanceof Error ? error.message : String(error),
      stepName: error?.stepName,
    };
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

  if (manifest.dslVersion !== 'v1' && manifest.dslVersion !== 'v2') {
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
