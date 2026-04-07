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

function hasTable(): boolean {
  const row = getDb()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schedule_run_steps'")
    .get() as { name?: string } | undefined;
  return row?.name === 'schedule_run_steps';
}

export function insertRunStep(runId: string, stepId: string, presetName = ''): string {
  const id = randomUUID();
  if (!hasTable()) return id;
  getDb().prepare(
    'INSERT INTO schedule_run_steps (id, run_id, step_id, preset_name, status, started_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, runId, stepId, presetName, 'running', new Date().toISOString());
  return id;
}

export function updateRunStep(
  runId: string,
  stepId: string,
  status: ScheduleRunStep['status'],
  error = '',
  durationMs?: number,
  outputSummary = '',
): void {
  if (!hasTable()) return;
  getDb().prepare(`
    UPDATE schedule_run_steps
    SET status = ?, error = ?, duration_ms = ?, output_summary = ?, completed_at = ?
    WHERE run_id = ? AND step_id = ?
  `).run(
    status,
    error,
    durationMs ?? null,
    outputSummary.slice(0, 2000),
    new Date().toISOString(),
    runId,
    stepId,
  );
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
