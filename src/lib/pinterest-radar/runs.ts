// Pinterest Trends 选品雷达 — 轮次 CRUD + 步骤状态机 + 日志

import { randomUUID } from 'node:crypto';

import { getDb } from '../db/connection';
import { listActiveJobKeys } from './jobs';
import {
  DEFAULT_RUN_CONFIG,
  type CreateRunInput,
  type PinterestRunRow,
  type PinterestStepRow,
  type RunConfig,
  type StepId,
  type StepState,
} from './types';

export const ALL_STEPS: StepId[] = ['huntground', 'collect', 'metrics', 'analyze', 'etsy_listings', 'report'];

interface RunDbRow {
  id: string;
  label: string;
  status: string;
  started_at: number;
  finished_at: number | null;
  failure_reason: string;
  summary: string;
  config_json: string;
  trending_count: number;
  metrics_count: number;
  analyzed_count: number;
}

interface StepDbRow {
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

function rowToRun(r: RunDbRow): PinterestRunRow {
  let cfg: RunConfig = { ...DEFAULT_RUN_CONFIG };
  try {
    const parsed = JSON.parse(r.config_json || '{}') as Partial<RunConfig>;
    cfg = { ...DEFAULT_RUN_CONFIG, ...parsed };
  } catch { /* keep default */ }
  return {
    id: r.id,
    label: r.label,
    status: r.status as PinterestRunRow['status'],
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    failureReason: r.failure_reason,
    summary: r.summary,
    trendingCount: r.trending_count,
    metricsCount: r.metrics_count,
    analyzedCount: r.analyzed_count,
    config: cfg,
  };
}

function rowToStep(r: StepDbRow): PinterestStepRow {
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

/**
 * 进程重启后 DB 里残留 state='running' 的 step,in-flight job 已丢。
 * 把这种孤儿步骤标 failed,允许用户重跑。
 * listRuns / listSteps 入口调一次。
 */
export function reconcileOrphanSteps(activeJobKeys: Set<string>): number {
  const db = getDb();
  const rows = db.prepare(`SELECT run_id, step_id FROM pinterest_run_steps WHERE state = 'running'`).all() as Array<{ run_id: string; step_id: string }>;
  let fixed = 0;
  for (const r of rows) {
    const k = `${r.run_id}:${r.step_id}`;
    if (activeJobKeys.has(k)) continue;
    db.prepare(`UPDATE pinterest_run_steps SET state = 'failed', error_message = ?, finished_at = ? WHERE run_id = ? AND step_id = ?`)
      .run('进程重启被中断 — 点"跑"继续(已跑过的会跳过)', Date.now(), r.run_id, r.step_id);
    appendLog(r.run_id, r.step_id as StepId, '⚠ 进程重启被中断 — 已重置为 failed,可手动重跑', 'warn');
    fixed++;
  }
  return fixed;
}

/** listRuns / listSteps 入口共用的孤儿恢复 — 懒执行,只在第一次调用时跑一次。
 *  jobs.ts 只 import type from ./types,无循环依赖,直接 ESM import 即可。 */
let orphanReconciled = false;
function ensureOrphansReconciled(): void {
  if (orphanReconciled) return;
  orphanReconciled = true;
  try {
    reconcileOrphanSteps(listActiveJobKeys());
  } catch { /* boot path,不阻塞 */ }
}

export function listRuns(): PinterestRunRow[] {
  ensureOrphansReconciled();
  const db = getDb();
  const rows = db.prepare('SELECT * FROM pinterest_runs ORDER BY started_at DESC LIMIT 50').all() as RunDbRow[];
  return rows.map(rowToRun);
}

export function getRun(id: string): PinterestRunRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM pinterest_runs WHERE id = ?').get(id) as RunDbRow | undefined;
  return row ? rowToRun(row) : null;
}

export function createRun(input: CreateRunInput): PinterestRunRow {
  const id = `PIN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 6)}`;
  const now = Date.now();
  const config: RunConfig = { ...DEFAULT_RUN_CONFIG, ...(input.config ?? {}) };
  const db = getDb();
  db.prepare(`
    INSERT INTO pinterest_runs (id, label, status, started_at, config_json)
    VALUES (?, ?, 'running', ?, ?)
  `).run(id, input.label, now, JSON.stringify(config));

  // 初始化 step machine — huntground 视为"配置完成"直接 done
  const stmt = db.prepare(`INSERT INTO pinterest_run_steps (run_id, step_id, state) VALUES (?, ?, ?)`);
  for (const stepId of ALL_STEPS) {
    const initial: StepState = stepId === 'huntground' ? 'done' : 'pending';
    stmt.run(id, stepId, initial);
  }

  return getRun(id)!;
}

export function deleteRun(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM pinterest_runs WHERE id = ?').run(id);
}

export function listSteps(runId: string): PinterestStepRow[] {
  ensureOrphansReconciled();
  const db = getDb();
  const rows = db.prepare('SELECT * FROM pinterest_run_steps WHERE run_id = ?').all(runId) as StepDbRow[];
  return rows.map(rowToStep);
}

export function getStep(runId: string, stepId: StepId): PinterestStepRow | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM pinterest_run_steps WHERE run_id = ? AND step_id = ?').get(runId, stepId) as StepDbRow | undefined;
  return row ? rowToStep(row) : null;
}

export interface StepPatch {
  state?: StepState;
  progressDone?: number;
  progressTotal?: number;
  errorMessage?: string;
  meta?: Record<string, unknown>;
}

export function updateStep(runId: string, stepId: StepId, patch: StepPatch): PinterestStepRow {
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
  if (patch.progressDone !== undefined) { sets.push('progress_done = ?'); params.push(patch.progressDone); }
  if (patch.progressTotal !== undefined) { sets.push('progress_total = ?'); params.push(patch.progressTotal); }
  if (patch.errorMessage !== undefined) { sets.push('error_message = ?'); params.push(patch.errorMessage); }
  if (patch.meta !== undefined) { sets.push('meta_json = ?'); params.push(JSON.stringify(patch.meta)); }
  if (sets.length === 0) return existing;

  params.push(runId, stepId);
  db.prepare(`UPDATE pinterest_run_steps SET ${sets.join(', ')} WHERE run_id = ? AND step_id = ?`).run(...params);

  return getStep(runId, stepId)!;
}

export function appendLog(runId: string, stepId: StepId, message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  const db = getDb();
  db.prepare(`INSERT INTO pinterest_run_logs (run_id, step_id, ts, level, message) VALUES (?, ?, ?, ?, ?)`)
    .run(runId, stepId, Date.now(), level, message.slice(0, 4000));
}

export function listLogs(
  runId: string,
  opts: { stepId?: StepId; sinceTs?: number; limit?: number } = {},
): Array<{ id: number; stepId: StepId; ts: number; level: string; message: string }> {
  const db = getDb();
  const conds: string[] = ['run_id = ?'];
  const params: unknown[] = [runId];
  if (opts.stepId) { conds.push('step_id = ?'); params.push(opts.stepId); }
  if (opts.sinceTs) { conds.push('ts > ?'); params.push(opts.sinceTs); }
  const limit = opts.limit ?? 500;
  const rows = db.prepare(
    `SELECT id, step_id, ts, level, message FROM pinterest_run_logs WHERE ${conds.join(' AND ')} ORDER BY ts ASC LIMIT ?`,
  ).all(...params, limit) as Array<{ id: number; step_id: string; ts: number; level: string; message: string }>;
  return rows.map((r) => ({ id: r.id, stepId: r.step_id as StepId, ts: r.ts, level: r.level, message: r.message }));
}

export function updateRunCounters(
  runId: string,
  patch: Partial<Pick<PinterestRunRow, 'trendingCount' | 'metricsCount' | 'analyzedCount' | 'summary' | 'failureReason' | 'status'>>,
): void {
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.trendingCount !== undefined) { sets.push('trending_count = ?'); params.push(patch.trendingCount); }
  if (patch.metricsCount !== undefined) { sets.push('metrics_count = ?'); params.push(patch.metricsCount); }
  if (patch.analyzedCount !== undefined) { sets.push('analyzed_count = ?'); params.push(patch.analyzedCount); }
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
  db.prepare(`UPDATE pinterest_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}
