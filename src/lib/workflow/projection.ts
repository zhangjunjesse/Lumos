import { getDb } from '@/lib/db/connection';
import type { CompiledWorkflowManifest, WorkflowExecutionStatus, WorkflowStatusResponse } from './types';

interface WorkflowProjectionRow {
  workflow_id: string;
  task_id: string;
  workflow_name: string;
  workflow_version: string;
  status: WorkflowExecutionStatus;
  progress: number;
  current_step: string | null;
  completed_steps_json: string;
  running_steps_json: string;
  skipped_steps_json: string;
  step_ids_json: string;
  result_json: string | null;
  error_json: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface WorkflowProjection extends WorkflowStatusResponse {
  workflowId: string;
  taskId: string;
  workflowName: string;
  workflowVersion: string;
  runningSteps: string[];
  skippedSteps: string[];
  stepIds: string[];
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

interface ProjectionUpdate {
  status?: WorkflowExecutionStatus;
  progress?: number;
  currentStep?: string | null;
  completedSteps?: string[];
  runningSteps?: string[];
  skippedSteps?: string[];
  stepIds?: string[];
  result?: unknown;
  error?: unknown;
  startedAt?: string | null;
  completedAt?: string | null;
}

function isTerminalWorkflowStatus(status: WorkflowExecutionStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export function createWorkflowDefinitionId(manifest: CompiledWorkflowManifest): string {
  return `${manifest.workflowName}@${manifest.workflowVersion}`;
}

export function persistWorkflowDefinition(
  manifest: CompiledWorkflowManifest,
  code: string
): void {
  const db = getDb();
  const now = nowIso();
  const workflowId = createWorkflowDefinitionId(manifest);

  db.prepare(
    [
      'INSERT INTO workflow_definitions (id, name, version, code, created_by, created_at)',
      'VALUES (?, ?, ?, ?, ?, ?)',
      'ON CONFLICT(id) DO UPDATE SET',
      'name = excluded.name,',
      'version = excluded.version,',
      'code = excluded.code,',
      'created_by = excluded.created_by',
    ].join(' ')
  ).run(
    workflowId,
    manifest.workflowName,
    manifest.workflowVersion,
    code,
    'llm',
    now
  );
}

export function persistWorkflowTaskMapping(
  manifest: CompiledWorkflowManifest,
  taskId: string,
  executionId: string
): void {
  const db = getDb();
  const workflowId = createWorkflowDefinitionId(manifest);

  db.prepare(
    [
      'INSERT INTO workflow_task_mapping (workflow_id, task_id, execution_id)',
      'VALUES (?, ?, ?)',
      'ON CONFLICT(workflow_id, task_id) DO UPDATE SET execution_id = excluded.execution_id',
    ].join(' ')
  ).run(workflowId, taskId, executionId);
}

export function initializeWorkflowProjection(
  workflowId: string,
  taskId: string,
  manifest: CompiledWorkflowManifest
): WorkflowProjection {
  const db = getDb();
  const now = nowIso();

  db.prepare(
    [
      'INSERT INTO workflow_executions (',
      'workflow_id, task_id, workflow_name, workflow_version, status, progress, current_step,',
      'completed_steps_json, running_steps_json, skipped_steps_json, step_ids_json,',
      'result_json, error_json, started_at, completed_at, updated_at',
      ') VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      'ON CONFLICT(workflow_id) DO UPDATE SET',
      'task_id = excluded.task_id,',
      'workflow_name = excluded.workflow_name,',
      'workflow_version = excluded.workflow_version,',
      'status = excluded.status,',
      'progress = excluded.progress,',
      'current_step = excluded.current_step,',
      'completed_steps_json = excluded.completed_steps_json,',
      'running_steps_json = excluded.running_steps_json,',
      'skipped_steps_json = excluded.skipped_steps_json,',
      'step_ids_json = excluded.step_ids_json,',
      'result_json = excluded.result_json,',
      'error_json = excluded.error_json,',
      'started_at = excluded.started_at,',
      'completed_at = excluded.completed_at,',
      'updated_at = excluded.updated_at',
    ].join(' ')
  ).run(
    workflowId,
    taskId,
    manifest.workflowName,
    manifest.workflowVersion,
    'pending',
    0,
    null,
    '[]',
    '[]',
    '[]',
    JSON.stringify(manifest.stepIds),
    null,
    null,
    null,
    null,
    now
  );

  return getWorkflowProjection(workflowId)!;
}

export function markWorkflowRunning(workflowId: string): WorkflowProjection | null {
  return updateWorkflowProjection(workflowId, (current) => {
    if (isTerminalWorkflowStatus(current.status)) {
      return {};
    }

    return {
      status: 'running',
      progress: current.progress > 0 ? current.progress : 5,
      startedAt: current.startedAt ?? nowIso(),
      completedAt: null,
    };
  });
}

export function markWorkflowStepStarted(
  workflowId: string,
  stepId: string
): WorkflowProjection | null {
  return updateWorkflowProjection(workflowId, (current) => {
    if (isTerminalWorkflowStatus(current.status)) {
      return {};
    }

    const runningSteps = appendUnique(current.runningSteps, stepId);
    return {
      status: current.status === 'pending' ? 'running' : current.status,
      currentStep: runningSteps[runningSteps.length - 1] ?? stepId,
      runningSteps,
      progress: computeRunningProgress(current.completedSteps, current.skippedSteps, current.stepIds),
      startedAt: current.startedAt ?? nowIso(),
    };
  });
}

export function markWorkflowStepCompleted(
  workflowId: string,
  stepId: string
): WorkflowProjection | null {
  return updateWorkflowProjection(workflowId, (current) => {
    if (isTerminalWorkflowStatus(current.status)) {
      return {};
    }

    const completedSteps = appendUnique(current.completedSteps, stepId);
    const runningSteps = removeValue(current.runningSteps, stepId);

    return {
      status: 'running',
      completedSteps,
      runningSteps,
      currentStep: runningSteps[runningSteps.length - 1] ?? null,
      progress: computeRunningProgress(completedSteps, current.skippedSteps, current.stepIds),
      startedAt: current.startedAt ?? nowIso(),
    };
  });
}

export function markWorkflowStepSkipped(
  workflowId: string,
  stepId: string
): WorkflowProjection | null {
  return updateWorkflowProjection(workflowId, (current) => {
    if (isTerminalWorkflowStatus(current.status)) {
      return {};
    }

    const skippedSteps = appendUnique(current.skippedSteps, stepId);
    const runningSteps = removeValue(current.runningSteps, stepId);

    return {
      status: current.status === 'pending' ? 'running' : current.status,
      skippedSteps,
      runningSteps,
      currentStep: runningSteps[runningSteps.length - 1] ?? null,
      progress: computeRunningProgress(current.completedSteps, skippedSteps, current.stepIds),
      startedAt: current.startedAt ?? nowIso(),
    };
  });
}

export function completeWorkflowProjection(
  workflowId: string,
  result: unknown
): WorkflowProjection | null {
  return updateWorkflowProjection(workflowId, () => ({
    status: 'completed',
    progress: 100,
    currentStep: null,
    runningSteps: [],
    result,
    error: null,
    completedAt: nowIso(),
  }));
}

export function failWorkflowProjection(
  workflowId: string,
  error: unknown
): WorkflowProjection | null {
  return updateWorkflowProjection(workflowId, (current) => ({
    status: 'failed',
    progress: current.progress,
    currentStep: null,
    runningSteps: [],
    error,
    completedAt: nowIso(),
  }));
}

export function cancelWorkflowProjection(workflowId: string): WorkflowProjection | null {
  return updateWorkflowProjection(workflowId, (current) => ({
    status: 'cancelled',
    progress: current.progress,
    currentStep: null,
    runningSteps: [],
    error: current.error ?? { code: 'WORKFLOW_CANCELLED', message: 'Cancelled by user' },
    completedAt: nowIso(),
  }));
}

export function getWorkflowProjection(workflowId: string): WorkflowProjection | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT * FROM workflow_executions WHERE workflow_id = ?'
  ).get(workflowId) as WorkflowProjectionRow | undefined;

  return row ? rowToProjection(row) : null;
}

export function clearWorkflowProjectionTables(): void {
  const db = getDb();
  db.exec(`
    DELETE FROM workflow_task_mapping;
    DELETE FROM workflow_definitions;
    DELETE FROM workflow_executions;
  `);
}

function updateWorkflowProjection(
  workflowId: string,
  updater: (current: WorkflowProjection) => ProjectionUpdate
): WorkflowProjection | null {
  const current = getWorkflowProjection(workflowId);
  if (!current) {
    return null;
  }

  const next = updater(current);
  const db = getDb();

  db.prepare(
    [
      'UPDATE workflow_executions SET',
      'status = ?,',
      'progress = ?,',
      'current_step = ?,',
      'completed_steps_json = ?,',
      'running_steps_json = ?,',
      'skipped_steps_json = ?,',
      'step_ids_json = ?,',
      'result_json = ?,',
      'error_json = ?,',
      'started_at = ?,',
      'completed_at = ?,',
      'updated_at = ?',
      'WHERE workflow_id = ?',
    ].join(' ')
  ).run(
    next.status ?? current.status,
    next.progress ?? current.progress,
    next.currentStep === undefined ? current.currentStep ?? null : next.currentStep,
    JSON.stringify(next.completedSteps ?? current.completedSteps),
    JSON.stringify(next.runningSteps ?? current.runningSteps),
    JSON.stringify(next.skippedSteps ?? current.skippedSteps),
    JSON.stringify(next.stepIds ?? current.stepIds),
    serializeJson(next.result === undefined ? current.result : next.result),
    serializeJson(next.error === undefined ? current.error : next.error),
    next.startedAt === undefined ? current.startedAt ?? null : next.startedAt,
    next.completedAt === undefined ? current.completedAt ?? null : next.completedAt,
    nowIso(),
    workflowId
  );

  return getWorkflowProjection(workflowId);
}

function rowToProjection(row: WorkflowProjectionRow): WorkflowProjection {
  return {
    workflowId: row.workflow_id,
    taskId: row.task_id,
    workflowName: row.workflow_name,
    workflowVersion: row.workflow_version,
    status: row.status,
    progress: row.progress,
    currentStep: row.current_step ?? undefined,
    completedSteps: parseJsonArray(row.completed_steps_json),
    runningSteps: parseJsonArray(row.running_steps_json),
    skippedSteps: parseJsonArray(row.skipped_steps_json),
    stepIds: parseJsonArray(row.step_ids_json),
    result: parseJsonValue(row.result_json),
    error: parseJsonValue(row.error_json),
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

function parseJsonValue(value: string | null): unknown {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function serializeJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function computeRunningProgress(
  completedSteps: string[],
  skippedSteps: string[],
  stepIds: string[]
): number {
  if (stepIds.length === 0) {
    return 0;
  }

  const finishedCount = new Set([...completedSteps, ...skippedSteps]).size;
  if (finishedCount === 0) {
    return 5;
  }

  if (finishedCount >= stepIds.length) {
    return 95;
  }

  return Math.min(95, Math.max(5, Math.round((finishedCount / stepIds.length) * 100)));
}

function appendUnique(values: string[], nextValue: string): string[] {
  return values.includes(nextValue) ? values : [...values, nextValue];
}

function removeValue(values: string[], target: string): string[] {
  return values.filter((value) => value !== target);
}

function nowIso(): string {
  return new Date().toISOString();
}
