import { randomUUID } from 'crypto';
import { getDb } from './index';

export interface ScheduleRunStep {
  id: string;
  runId: string;
  stepId: string;
  presetName: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  error: string;
  outputSummary: string;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ScheduleRunStepSnapshot {
  stepId: string;
  presetName?: string;
  status: ScheduleRunStep['status'];
  error?: string;
  outputSummary?: string;
  durationMs?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

function hasTable(): boolean {
  const row = getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schedule_run_steps'")
    .get() as { name?: string } | undefined;
  return row?.name === 'schedule_run_steps';
}

interface ExistingRunStepRow {
  id: string;
  output_summary: string | null;
  started_at: string | null;
}

function getExistingRunStep(runId: string, stepId: string): ExistingRunStepRow | null {
  if (!hasTable()) return null;
  const row = getDb().prepare(
    'SELECT id, output_summary, started_at FROM schedule_run_steps WHERE run_id = ? AND step_id = ? LIMIT 1',
  ).get(runId, stepId) as ExistingRunStepRow | undefined;
  return row ?? null;
}

export function insertRunStep(runId: string, stepId: string, presetName = ''): string {
  if (!hasTable()) return '';
  const existing = getExistingRunStep(runId, stepId);
  const now = new Date().toISOString();
  if (existing) {
    getDb().prepare(`
      UPDATE schedule_run_steps
      SET preset_name = CASE WHEN ? <> '' THEN ? ELSE preset_name END,
          status = 'running',
          error = '',
          completed_at = NULL,
          started_at = COALESCE(started_at, ?)
      WHERE id = ?
    `).run(presetName, presetName, now, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  getDb().prepare(
    'INSERT INTO schedule_run_steps (id, run_id, step_id, preset_name, status, started_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, runId, stepId, presetName, 'running', now);
  return id;
}

export function seedRunStepSnapshot(runId: string, snapshot: ScheduleRunStepSnapshot): string {
  if (!hasTable()) return '';
  const stepId = snapshot.stepId.trim();
  if (!stepId) return '';
  const existing = getExistingRunStep(runId, stepId);
  const now = new Date().toISOString();
  const startedAt = snapshot.startedAt || snapshot.completedAt || now;
  const completedAt = snapshot.completedAt || (snapshot.status === 'running' || snapshot.status === 'pending' ? null : startedAt);
  const durationMs = typeof snapshot.durationMs === 'number' && Number.isFinite(snapshot.durationMs)
    ? Math.max(0, Math.floor(snapshot.durationMs))
    : null;
  const outputSummary = (snapshot.outputSummary || '').slice(0, 2000);
  const presetName = snapshot.presetName || '';
  const error = snapshot.error || '';

  if (existing) {
    getDb().prepare(`
      UPDATE schedule_run_steps
      SET preset_name = CASE WHEN ? <> '' THEN ? ELSE preset_name END,
          status = ?,
          error = ?,
          output_summary = CASE WHEN ? <> '' THEN ? ELSE output_summary END,
          duration_ms = COALESCE(?, duration_ms),
          started_at = COALESCE(started_at, ?),
          completed_at = COALESCE(?, completed_at)
      WHERE id = ?
    `).run(
      presetName,
      presetName,
      snapshot.status,
      error,
      outputSummary,
      outputSummary,
      durationMs,
      startedAt,
      completedAt,
      existing.id,
    );
    return existing.id;
  }

  const id = randomUUID();
  getDb().prepare(`
    INSERT INTO schedule_run_steps
      (id, run_id, step_id, preset_name, status, error, output_summary, duration_ms, started_at, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    runId,
    stepId,
    presetName,
    snapshot.status,
    error,
    outputSummary,
    durationMs,
    startedAt,
    completedAt,
  );
  return id;
}

export function updateRunStep(
  runId: string,
  stepId: string,
  status: ScheduleRunStep['status'],
  error = '',
  durationMs?: number,
  outputSummary?: string,
): void {
  if (!hasTable()) return;
  const existing = getExistingRunStep(runId, stepId);
  if (!existing) {
    insertRunStep(runId, stepId);
  }
  const row = existing ?? getExistingRunStep(runId, stepId);
  const resolvedDurationMs = (
    typeof durationMs === 'number'
      ? durationMs
      : row?.started_at
        ? Math.max(0, Date.now() - Date.parse(row.started_at))
        : null
  );
  const resolvedSummary = typeof outputSummary === 'string'
    ? outputSummary
    : row?.output_summary ?? '';
  getDb().prepare(`
    UPDATE schedule_run_steps
    SET status = ?, error = ?, duration_ms = ?, output_summary = ?, completed_at = ?
    WHERE run_id = ? AND step_id = ?
  `).run(
    status,
    error,
    resolvedDurationMs,
    resolvedSummary.slice(0, 2000),
    new Date().toISOString(),
    runId,
    stepId,
  );
}

export function setRunStepOutputSummary(runId: string, stepId: string, outputSummary: string): void {
  if (!hasTable()) return;
  if (!getExistingRunStep(runId, stepId)) {
    insertRunStep(runId, stepId);
  }
  getDb().prepare(
    'UPDATE schedule_run_steps SET output_summary = ? WHERE run_id = ? AND step_id = ?',
  ).run(outputSummary.slice(0, 2000), runId, stepId);
}

export function cancelRunningRunSteps(runId: string, reason = '用户已取消任务'): void {
  if (!hasTable()) return;
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE schedule_run_steps
    SET status = 'error',
        error = CASE WHEN error <> '' THEN error ELSE ? END,
        completed_at = COALESCE(completed_at, ?),
        duration_ms = CASE
          WHEN duration_ms IS NOT NULL THEN duration_ms
          WHEN started_at IS NOT NULL THEN MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER))
          ELSE NULL
        END
    WHERE run_id = ?
      AND status IN ('pending', 'running')
  `).run(reason, now, now, runId);
}

export function listRunSteps(runId: string): ScheduleRunStep[] {
  if (!hasTable()) return [];
  const rows = getDb().prepare(
    'SELECT * FROM schedule_run_steps WHERE run_id = ? ORDER BY started_at ASC',
  ).all(runId) as Array<Record<string, unknown>>;
  return rows.map(r => ({
    id: String(r['id']),
    runId: String(r['run_id']),
    stepId: String(r['step_id']),
    presetName: String(r['preset_name'] ?? ''),
    status: String(r['status']) as ScheduleRunStep['status'],
    error: String(r['error'] ?? ''),
    outputSummary: String(r['output_summary'] ?? ''),
    durationMs: typeof r['duration_ms'] === 'number' ? r['duration_ms'] : null,
    startedAt: r['started_at'] ? String(r['started_at']) : null,
    completedAt: r['completed_at'] ? String(r['completed_at']) : null,
  }));
}

/** Keep only the most recent N run histories per schedule; also cleans associated steps. */
export function cleanupOldRunHistory(scheduleId: string, keepCount = 100): void {
  const db = getDb();
  try {
    const old = db.prepare(`
      SELECT id FROM schedule_run_history
      WHERE schedule_id = ?
      ORDER BY started_at DESC
      LIMIT -1 OFFSET ?
    `).all(scheduleId, keepCount) as Array<{ id: string }>;
    if (old.length === 0) return;
    const ids = old.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM schedule_run_steps WHERE run_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM schedule_run_history WHERE id IN (${placeholders})`).run(...ids);
  } catch { /* non-fatal */ }
}

/** Check if a schedule has a currently running execution. */
export function hasRunningExecution(scheduleId: string): boolean {
  try {
    const row = getDb().prepare(
      "SELECT id FROM schedule_run_history WHERE schedule_id = ? AND status = 'running' LIMIT 1",
    ).get(scheduleId) as { id?: string } | undefined;
    return Boolean(row?.id);
  } catch {
    return false;
  }
}
