import { randomUUID } from 'crypto';
import { getDb } from './index';
import type { WorkflowDSL } from '@/lib/workflow/types';

export interface ScheduledWorkflowRow {
  id: string;
  name: string;
  workflow_dsl: string;
  interval_minutes: number;
  working_directory: string;
  enabled: number;
  notify_on_complete: number;
  last_run_at: string | null;
  next_run_at: string | null;
  run_count: number;
  last_run_status: string;
  last_error: string;
  created_at: string;
  updated_at: string;
}

export interface ScheduledWorkflow {
  id: string;
  name: string;
  workflowDsl: WorkflowDSL;
  intervalMinutes: number;
  workingDirectory: string;
  enabled: boolean;
  notifyOnComplete: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  lastRunStatus: 'success' | 'error' | '';
  lastError: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduledWorkflowInput {
  name: string;
  workflowDsl: WorkflowDSL;
  intervalMinutes: number;
  workingDirectory?: string;
  notifyOnComplete?: boolean;
}

export type UpdateScheduledWorkflowInput = Partial<{
  name: string;
  workflowDsl: WorkflowDSL;
  intervalMinutes: number;
  workingDirectory: string;
  enabled: boolean;
  notifyOnComplete: boolean;
}>;

function rowToSchedule(row: ScheduledWorkflowRow): ScheduledWorkflow {
  let dsl: WorkflowDSL;
  try {
    dsl = JSON.parse(row.workflow_dsl) as WorkflowDSL;
  } catch {
    dsl = { version: 'v1', name: row.name, steps: [] };
  }
  return {
    id: row.id,
    name: row.name,
    workflowDsl: dsl,
    intervalMinutes: row.interval_minutes,
    workingDirectory: row.working_directory,
    enabled: row.enabled === 1,
    notifyOnComplete: row.notify_on_complete === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    runCount: row.run_count,
    lastRunStatus: row.last_run_status as ScheduledWorkflow['lastRunStatus'],
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function computeNextRunAt(intervalMinutes: number): string {
  const next = new Date(Date.now() + intervalMinutes * 60 * 1000);
  return next.toISOString();
}

function hasTable(): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='scheduled_workflows'")
    .get() as { name?: string } | undefined;
  return row?.name === 'scheduled_workflows';
}

export function listScheduledWorkflows(): ScheduledWorkflow[] {
  if (!hasTable()) return [];
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM scheduled_workflows ORDER BY created_at DESC')
    .all() as ScheduledWorkflowRow[];
  return rows.map(rowToSchedule);
}

export function getScheduledWorkflow(id: string): ScheduledWorkflow | null {
  if (!hasTable()) return null;
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM scheduled_workflows WHERE id = ?')
    .get(id) as ScheduledWorkflowRow | undefined;
  return row ? rowToSchedule(row) : null;
}

export function listDueSchedules(): ScheduledWorkflow[] {
  if (!hasTable()) return [];
  const db = getDb();
  const now = new Date().toISOString();
  const rows = db
    .prepare(`
      SELECT * FROM scheduled_workflows
      WHERE enabled = 1
        AND (next_run_at IS NULL OR next_run_at <= ?)
      ORDER BY next_run_at ASC
    `)
    .all(now) as ScheduledWorkflowRow[];
  return rows.map(rowToSchedule);
}

export function createScheduledWorkflow(
  input: CreateScheduledWorkflowInput,
): ScheduledWorkflow {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const nextRunAt = computeNextRunAt(input.intervalMinutes);

  db.prepare(`
    INSERT INTO scheduled_workflows
      (id, name, workflow_dsl, interval_minutes, working_directory, enabled, notify_on_complete, next_run_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(
    id,
    input.name.trim(),
    JSON.stringify(input.workflowDsl),
    input.intervalMinutes,
    (input.workingDirectory || '').trim(),
    input.notifyOnComplete !== false ? 1 : 0,
    nextRunAt,
    now,
    now,
  );

  const schedule = getScheduledWorkflow(id);
  if (!schedule) throw new Error('Failed to create scheduled workflow');
  return schedule;
}

export function updateScheduledWorkflow(
  id: string,
  input: UpdateScheduledWorkflowInput,
): ScheduledWorkflow | null {
  const existing = getScheduledWorkflow(id);
  if (!existing) return null;

  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const intervalMinutes = input.intervalMinutes ?? existing.intervalMinutes;
  const nextRunAt = input.intervalMinutes ? computeNextRunAt(input.intervalMinutes) : existing.nextRunAt;

  db.prepare(`
    UPDATE scheduled_workflows SET
      name = ?,
      workflow_dsl = ?,
      interval_minutes = ?,
      working_directory = ?,
      enabled = ?,
      notify_on_complete = ?,
      next_run_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    input.name ?? existing.name,
    input.workflowDsl ? JSON.stringify(input.workflowDsl) : JSON.stringify(existing.workflowDsl),
    intervalMinutes,
    input.workingDirectory ?? existing.workingDirectory,
    (input.enabled ?? existing.enabled) ? 1 : 0,
    (input.notifyOnComplete ?? existing.notifyOnComplete) ? 1 : 0,
    nextRunAt,
    now,
    id,
  );

  return getScheduledWorkflow(id);
}

export function recordScheduleRun(
  id: string,
  status: 'success' | 'error',
  error = '',
): void {
  if (!hasTable()) return;
  const db = getDb();
  const schedule = getScheduledWorkflow(id);
  if (!schedule) return;

  const now = new Date().toISOString();
  const nextRunAt = computeNextRunAt(schedule.intervalMinutes);

  db.prepare(`
    UPDATE scheduled_workflows SET
      last_run_at = ?,
      next_run_at = ?,
      run_count = run_count + 1,
      last_run_status = ?,
      last_error = ?,
      updated_at = ?
    WHERE id = ?
  `).run(now, nextRunAt, status, error, now.replace('T', ' ').slice(0, 19), id);
}

export function deleteScheduledWorkflow(id: string): boolean {
  if (!hasTable()) return false;
  const db = getDb();
  const result = db.prepare('DELETE FROM scheduled_workflows WHERE id = ?').run(id);
  return result.changes > 0;
}
