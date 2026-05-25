// 轮次 CRUD + 步骤状态机 + 日志

import { getDb } from '../db/connection';
import { ALL_STEPS, DEFAULT_RUN_CONFIG, type CreateRunInput, type RadarRunRow, type RadarStepRow, type RunConfig, type StepId, type StepState } from './types';
import { randomUUID } from 'node:crypto';

interface RadarRunDbRow {
  id: string;
  label: string;
  status: string;
  entry_mode: string;
  executor: string;
  capabilities_json: string;
  market: string;
  platform: string;
  started_at: number;
  finished_at: number | null;
  failure_reason: string;
  summary: string;
  seed_count: number;
  converge_count: number;
  grade_a: number;
  grade_b: number;
  grade_c: number;
  config_json: string;
}

interface RadarStepDbRow {
  run_id: string;
  step_id: string;
  state: string;
  progress_done: number;
  progress_total: number;
  started_at: number | null;
  finished_at: number | null;
  error_message: string;
  meta_json: string;
}

function rowToRun(r: RadarRunDbRow): RadarRunRow {
  let cfg: RunConfig = { ...DEFAULT_RUN_CONFIG };
  try {
    const parsed = JSON.parse(r.config_json || '{}') as Partial<RunConfig>;
    cfg = { ...DEFAULT_RUN_CONFIG, ...parsed };
  } catch { /* keep default */ }
  return {
    id: r.id,
    label: r.label,
    status: r.status as RadarRunRow['status'],
    entryMode: r.entry_mode as RadarRunRow['entryMode'],
    executor: r.executor as RadarRunRow['executor'],
    capabilities: JSON.parse(r.capabilities_json || '[]'),
    market: r.market,
    platform: r.platform,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    failureReason: r.failure_reason,
    summary: r.summary,
    seedCount: r.seed_count,
    convergeCount: r.converge_count,
    gradeA: r.grade_a,
    gradeB: r.grade_b,
    gradeC: r.grade_c,
    config: cfg,
  };
}

function rowToStep(r: RadarStepDbRow): RadarStepRow {
  return {
    runId: r.run_id,
    stepId: r.step_id as StepId,
    state: r.state as StepState,
    progressDone: r.progress_done,
    progressTotal: r.progress_total,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    errorMessage: r.error_message,
    meta: JSON.parse(r.meta_json || '{}'),
  };
}

export function listRuns(): RadarRunRow[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM radar_runs ORDER BY started_at DESC LIMIT 50').all() as RadarRunDbRow[];
  return rows.map(rowToRun);
}

export function getRun(id: string): RadarRunRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM radar_runs WHERE id = ?').get(id) as RadarRunDbRow | undefined;
  return row ? rowToRun(row) : null;
}

export function createRun(input: CreateRunInput): RadarRunRow {
  const id = `RUN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 6)}`;
  const now = Date.now();
  const config: RunConfig = { ...DEFAULT_RUN_CONFIG, ...(input.config ?? {}) };
  const db = getDb();
  db.prepare(`
    INSERT INTO radar_runs (id, label, status, entry_mode, executor, capabilities_json, market, platform, started_at, config_json)
    VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.label,
    input.entryMode,
    input.executor ?? 'adspower',
    JSON.stringify(input.capabilities ?? []),
    input.market ?? 'US',
    input.platform ?? 'etsy',
    now,
    JSON.stringify(config),
  );

  // 初始化 step machine
  const stmt = db.prepare(`
    INSERT INTO radar_run_steps (run_id, step_id, state)
    VALUES (?, ?, ?)
  `);
  for (const stepId of ALL_STEPS) {
    let initial: StepState = 'pending';
    if (stepId === 'huntground') initial = input.entryMode === 'blank_slate' ? 'skipped' : 'done';
    stmt.run(id, stepId, initial);
  }

  return getRun(id)!;
}

export function archiveRun(id: string, status: 'completed' | 'failed' | 'archived' = 'archived'): void {
  const db = getDb();
  db.prepare(`UPDATE radar_runs SET status = ?, finished_at = ? WHERE id = ?`).run(status, Date.now(), id);
}

export function deleteRun(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM radar_runs WHERE id = ?').run(id);
}

export function listSteps(runId: string): RadarStepRow[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM radar_run_steps WHERE run_id = ?').all(runId) as RadarStepDbRow[];
  return rows.map(rowToStep);
}

export function getStep(runId: string, stepId: StepId): RadarStepRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM radar_run_steps WHERE run_id = ? AND step_id = ?').get(runId, stepId) as RadarStepDbRow | undefined;
  return row ? rowToStep(row) : null;
}

export interface StepPatch {
  state?: StepState;
  progressDone?: number;
  progressTotal?: number;
  errorMessage?: string;
  meta?: Record<string, unknown>;
}

export function updateStep(runId: string, stepId: StepId, patch: StepPatch): RadarStepRow {
  const db = getDb();
  const existing = getStep(runId, stepId);
  if (!existing) throw new Error(`step not found: ${runId}/${stepId}`);

  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.state !== undefined) {
    sets.push('state = ?');
    params.push(patch.state);
    if (patch.state === 'running' && !existing.startedAt) {
      sets.push('started_at = ?');
      params.push(Date.now());
    } else if (patch.state === 'done' || patch.state === 'failed' || patch.state === 'skipped') {
      sets.push('finished_at = ?');
      params.push(Date.now());
    }
  }
  if (patch.progressDone !== undefined) {
    sets.push('progress_done = ?');
    params.push(patch.progressDone);
  }
  if (patch.progressTotal !== undefined) {
    sets.push('progress_total = ?');
    params.push(patch.progressTotal);
  }
  if (patch.errorMessage !== undefined) {
    sets.push('error_message = ?');
    params.push(patch.errorMessage);
  }
  if (patch.meta !== undefined) {
    sets.push('meta_json = ?');
    params.push(JSON.stringify(patch.meta));
  }
  if (sets.length === 0) return existing;

  params.push(runId, stepId);
  db.prepare(`UPDATE radar_run_steps SET ${sets.join(', ')} WHERE run_id = ? AND step_id = ?`).run(...params);

  return getStep(runId, stepId)!;
}

export function appendLog(runId: string, stepId: StepId, message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  const db = getDb();
  db.prepare(`INSERT INTO radar_run_logs (run_id, step_id, ts, level, message) VALUES (?, ?, ?, ?, ?)`)
    .run(runId, stepId, Date.now(), level, message.slice(0, 4000));
}

export function listLogs(runId: string, opts: { stepId?: StepId; sinceTs?: number; limit?: number } = {}): Array<{ id: number; stepId: StepId; ts: number; level: string; message: string }> {
  const db = getDb();
  const conds: string[] = ['run_id = ?'];
  const params: unknown[] = [runId];
  if (opts.stepId) {
    conds.push('step_id = ?');
    params.push(opts.stepId);
  }
  if (opts.sinceTs) {
    conds.push('ts > ?');
    params.push(opts.sinceTs);
  }
  const limit = opts.limit ?? 500;
  const rows = db.prepare(
    `SELECT id, step_id, ts, level, message FROM radar_run_logs WHERE ${conds.join(' AND ')} ORDER BY ts ASC LIMIT ?`,
  ).all(...params, limit) as Array<{ id: number; step_id: string; ts: number; level: string; message: string }>;
  return rows.map((r) => ({ id: r.id, stepId: r.step_id as StepId, ts: r.ts, level: r.level, message: r.message }));
}

/**
 * Process 重启后,DB 里可能残留 state='running' 的 step,但 in-flight job 已丢失。
 * 这函数把这种孤儿状态标记为 'failed',让用户能"续跑"。
 * 任何调 listSteps / getStep 的入口可以在前面调一次。
 */
export function reconcileOrphanSteps(activeJobKeys: Set<string>): number {
  const db = getDb();
  const rows = db.prepare(`SELECT run_id, step_id FROM radar_run_steps WHERE state = 'running'`).all() as Array<{ run_id: string; step_id: string }>;
  let fixed = 0;
  for (const r of rows) {
    const k = `${r.run_id}:${r.step_id}`;
    if (activeJobKeys.has(k)) continue;
    db.prepare(`UPDATE radar_run_steps SET state = 'failed', error_message = ?, finished_at = ? WHERE run_id = ? AND step_id = ?`)
      .run('进程重启被中断 — 点"续跑"继续(已跑过的会跳过)', Date.now(), r.run_id, r.step_id);
    appendLog(r.run_id, r.step_id as StepId, '⚠ 进程重启被中断 — 自动重置为 failed,可点"续跑"', 'warn');
    fixed++;
  }
  return fixed;
}

export function updateRunCounters(runId: string, patch: Partial<Pick<RadarRunRow, 'seedCount' | 'convergeCount' | 'gradeA' | 'gradeB' | 'gradeC' | 'summary' | 'failureReason' | 'status'>>): void {
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.seedCount !== undefined) { sets.push('seed_count = ?'); params.push(patch.seedCount); }
  if (patch.convergeCount !== undefined) { sets.push('converge_count = ?'); params.push(patch.convergeCount); }
  if (patch.gradeA !== undefined) { sets.push('grade_a = ?'); params.push(patch.gradeA); }
  if (patch.gradeB !== undefined) { sets.push('grade_b = ?'); params.push(patch.gradeB); }
  if (patch.gradeC !== undefined) { sets.push('grade_c = ?'); params.push(patch.gradeC); }
  if (patch.summary !== undefined) { sets.push('summary = ?'); params.push(patch.summary); }
  if (patch.failureReason !== undefined) { sets.push('failure_reason = ?'); params.push(patch.failureReason); }
  if (patch.status !== undefined) {
    sets.push('status = ?');
    params.push(patch.status);
    if (patch.status === 'completed' || patch.status === 'failed') {
      sets.push('finished_at = ?');
      params.push(Date.now());
    }
  }
  if (sets.length === 0) return;
  params.push(runId);
  db.prepare(`UPDATE radar_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}
