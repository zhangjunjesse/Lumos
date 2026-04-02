import { randomUUID } from 'crypto';
import { getDb } from './index';

import type { WorkflowDSL } from '@/lib/workflow/types';

export type RunMode = 'scheduled' | 'once';

export interface ScheduledWorkflowRow {
  id: string;
  name: string;
  workflow_dsl: string;
  workflow_id: string | null;
  run_mode: string;
  interval_minutes: number;
  working_directory: string;
  enabled: number;
  notify_on_complete: number;
  run_params: string;
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
  workflowId: string | null;
  runMode: RunMode;
  intervalMinutes: number;
  workingDirectory: string;
  enabled: boolean;
  notifyOnComplete: boolean;
  runParams: Record<string, unknown>;
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
  workflowId?: string;
  runMode?: RunMode;
  intervalMinutes: number;
  workingDirectory?: string;
  notifyOnComplete?: boolean;
  runParams?: Record<string, unknown>;
}

export type UpdateScheduledWorkflowInput = Partial<{
  name: string;
  workflowDsl: WorkflowDSL;
  workflowId: string | null;
  runMode: RunMode;
  intervalMinutes: number;
  workingDirectory: string;
  enabled: boolean;
  notifyOnComplete: boolean;
  runParams: Record<string, unknown>;
}>;

function rowToSchedule(row: ScheduledWorkflowRow): ScheduledWorkflow {
  let dsl: WorkflowDSL;
  try {
    dsl = JSON.parse(row.workflow_dsl) as WorkflowDSL;
  } catch {
    dsl = { version: 'v1', name: row.name, steps: [] };
  }
  let runParams: Record<string, unknown> = {};
  try {
    runParams = JSON.parse(row.run_params || '{}') as Record<string, unknown>;
  } catch { /* ignore */ }
  return {
    id: row.id,
    name: row.name,
    workflowDsl: dsl,
    workflowId: row.workflow_id || null,
    runMode: (row.run_mode === 'once' ? 'once' : 'scheduled') as RunMode,
    intervalMinutes: row.interval_minutes,
    workingDirectory: row.working_directory,
    enabled: row.enabled === 1,
    notifyOnComplete: row.notify_on_complete === 1,
    runParams,
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
  const runMode: RunMode = input.runMode || 'scheduled';
  // One-time tasks run immediately; scheduled tasks run after interval
  const nextRunAt = runMode === 'once' ? now : computeNextRunAt(input.intervalMinutes);

  db.prepare(`
    INSERT INTO scheduled_workflows
      (id, name, workflow_dsl, workflow_id, run_mode, interval_minutes, working_directory, enabled, notify_on_complete, run_params, next_run_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name.trim(),
    JSON.stringify(input.workflowDsl),
    input.workflowId || null,
    runMode,
    input.intervalMinutes,
    (input.workingDirectory || '').trim(),
    input.notifyOnComplete !== false ? 1 : 0,
    JSON.stringify(input.runParams ?? {}),
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
  const nextRunAt = input.intervalMinutes !== undefined ? computeNextRunAt(input.intervalMinutes) : existing.nextRunAt;

  db.prepare(`
    UPDATE scheduled_workflows SET
      name = ?,
      workflow_dsl = ?,
      workflow_id = ?,
      run_mode = ?,
      interval_minutes = ?,
      working_directory = ?,
      enabled = ?,
      notify_on_complete = ?,
      run_params = ?,
      next_run_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    input.name ?? existing.name,
    input.workflowDsl ? JSON.stringify(input.workflowDsl) : JSON.stringify(existing.workflowDsl),
    input.workflowId !== undefined ? input.workflowId : existing.workflowId,
    input.runMode ?? existing.runMode,
    intervalMinutes,
    input.workingDirectory ?? existing.workingDirectory,
    (input.enabled ?? existing.enabled) ? 1 : 0,
    (input.notifyOnComplete ?? existing.notifyOnComplete) ? 1 : 0,
    JSON.stringify(input.runParams ?? existing.runParams),
    nextRunAt,
    now,
    id,
  );

  return getScheduledWorkflow(id);
}

/** Advance next_run_at only — used at the start of execution to prevent re-trigger. Does NOT touch run_count or status. */
export function advanceScheduleTimer(id: string): void {
  if (!hasTable()) return;
  const schedule = getScheduledWorkflow(id);
  if (!schedule) return;
  getDb().prepare('UPDATE scheduled_workflows SET next_run_at = ? WHERE id = ?')
    .run(computeNextRunAt(schedule.intervalMinutes), id);
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

// ── Run history ──────────────────────────────────────────────────────────────

export interface ScheduleRunRecord {
  id: string;
  scheduleId: string;
  sessionId: string | null;
  status: 'running' | 'success' | 'error';
  error: string;
  startedAt: string;
  completedAt: string | null;
}

function hasHistoryTable(): boolean {
  const db = getDb();
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schedule_run_history'").get() as { name?: string } | undefined;
  return row?.name === 'schedule_run_history';
}

export function insertRunHistory(scheduleId: string, sessionId: string | null): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  if (!hasHistoryTable()) return id;
  getDb().prepare(
    'INSERT INTO schedule_run_history (id, schedule_id, session_id, status, started_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, scheduleId, sessionId, 'running', now);
  return id;
}

export function updateRunHistory(id: string, status: 'success' | 'error', error = ''): void {
  if (!hasHistoryTable()) return;
  getDb().prepare(
    'UPDATE schedule_run_history SET status = ?, error = ?, completed_at = ? WHERE id = ?',
  ).run(status, error, new Date().toISOString(), id);
}

export function listRunHistory(scheduleId: string, limit = 30): ScheduleRunRecord[] {
  if (!hasHistoryTable()) return [];
  return (getDb().prepare(
    'SELECT * FROM schedule_run_history WHERE schedule_id = ? ORDER BY started_at DESC LIMIT ?',
  ).all(scheduleId, limit) as Array<Record<string, unknown>>).map(r => ({
    id: String(r['id']),
    scheduleId: String(r['schedule_id']),
    sessionId: r['session_id'] ? String(r['session_id']) : null,
    status: String(r['status']) as ScheduleRunRecord['status'],
    error: String(r['error'] ?? ''),
    startedAt: String(r['started_at']),
    completedAt: r['completed_at'] ? String(r['completed_at']) : null,
  }));
}

export function getRunHistory(runId: string): ScheduleRunRecord | null {
  if (!hasHistoryTable()) return null;
  const r = getDb().prepare(
    'SELECT * FROM schedule_run_history WHERE id = ?',
  ).get(runId) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    id: String(r['id']),
    scheduleId: String(r['schedule_id']),
    sessionId: r['session_id'] ? String(r['session_id']) : null,
    status: String(r['status']) as ScheduleRunRecord['status'],
    error: String(r['error'] ?? ''),
    startedAt: String(r['started_at']),
    completedAt: r['completed_at'] ? String(r['completed_at']) : null,
  };
}

export function getWorkflowExecutionId(sessionId: string): string | null {
  try {
    const r = getDb().prepare(
      'SELECT execution_id FROM workflow_task_mapping WHERE task_id = ? LIMIT 1',
    ).get(sessionId) as { execution_id?: string } | undefined;
    return r?.execution_id || null;
  } catch {
    return null;
  }
}

export function deleteScheduledWorkflow(id: string): boolean {
  if (!hasTable()) return false;
  const db = getDb();
  if (hasHistoryTable()) {
    db.prepare('DELETE FROM schedule_run_history WHERE schedule_id = ?').run(id);
  }
  const result = db.prepare('DELETE FROM scheduled_workflows WHERE id = ?').run(id);
  return result.changes > 0;
}
