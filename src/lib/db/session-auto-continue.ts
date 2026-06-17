import { getDb } from './connection';

export type SessionAutoContinueStatus = 'idle' | 'waiting' | 'running' | 'paused' | 'stopped' | 'failed';

export interface SessionAutoContinueState {
  session_id: string;
  enabled: boolean;
  status: SessionAutoContinueStatus;
  next_run_at: string | null;
  delay_seconds: number;
  round: number;
  max_rounds: number;
  fail_count: number;
  last_summary: string;
  last_error: string;
  stop_requested: boolean;
}

interface AutoContinueRow {
  id: string;
  auto_continue_enabled: number;
  auto_continue_status: SessionAutoContinueStatus;
  auto_continue_next_run_at: string | null;
  auto_continue_delay_seconds: number;
  auto_continue_round: number;
  auto_continue_max_rounds: number;
  auto_continue_fail_count: number;
  auto_continue_last_summary: string;
  auto_continue_last_error: string;
  auto_continue_stop_requested: number;
}

function nowSql(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

function toSqlDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').split('.')[0];
}

function clampDelay(seconds: number): number {
  if (!Number.isFinite(seconds)) return 60;
  return Math.max(30, Math.min(3600, Math.floor(seconds)));
}

function mapRow(row: AutoContinueRow): SessionAutoContinueState {
  return {
    session_id: row.id,
    enabled: row.auto_continue_enabled === 1,
    status: row.auto_continue_status,
    next_run_at: row.auto_continue_next_run_at || null,
    delay_seconds: row.auto_continue_delay_seconds,
    round: row.auto_continue_round,
    max_rounds: row.auto_continue_max_rounds,
    fail_count: row.auto_continue_fail_count,
    last_summary: row.auto_continue_last_summary || '',
    last_error: row.auto_continue_last_error || '',
    stop_requested: row.auto_continue_stop_requested === 1,
  };
}

export function getSessionAutoContinue(sessionId: string): SessionAutoContinueState | null {
  const row = getDb().prepare(`
    SELECT id, auto_continue_enabled, auto_continue_status, auto_continue_next_run_at,
      auto_continue_delay_seconds, auto_continue_round, auto_continue_max_rounds,
      auto_continue_fail_count, auto_continue_last_summary, auto_continue_last_error,
      auto_continue_stop_requested
    FROM chat_sessions WHERE id = ?
  `).get(sessionId) as AutoContinueRow | undefined;
  return row ? mapRow(row) : null;
}

export function enableSessionAutoContinue(
  sessionId: string,
  options: { delaySeconds?: number; maxRounds?: number; summary?: string } = {},
): SessionAutoContinueState | null {
  const delay = clampDelay(options.delaySeconds ?? 60);
  const maxRounds = Math.max(1, Math.min(1000, Math.floor(options.maxRounds ?? 100)));
  const nextRunAt = toSqlDate(Date.now() + delay * 1000);
  const now = nowSql();
  getDb().prepare(`
    UPDATE chat_sessions
    SET auto_continue_enabled = 1,
      auto_continue_status = 'waiting',
      auto_continue_next_run_at = ?,
      auto_continue_delay_seconds = ?,
      auto_continue_max_rounds = ?,
      auto_continue_last_summary = ?,
      auto_continue_last_error = '',
      auto_continue_stop_requested = 0,
      runtime_updated_at = ?
    WHERE id = ?
  `).run(nextRunAt, delay, maxRounds, options.summary || '', now, sessionId);
  return getSessionAutoContinue(sessionId);
}

export function scheduleSessionAutoContinue(
  sessionId: string,
  delaySeconds: number,
  summary: string,
): SessionAutoContinueState | null {
  const delay = clampDelay(delaySeconds);
  const nextRunAt = toSqlDate(Date.now() + delay * 1000);
  const now = nowSql();
  getDb().prepare(`
    UPDATE chat_sessions
    SET auto_continue_enabled = 1,
      auto_continue_status = 'waiting',
      auto_continue_next_run_at = ?,
      auto_continue_delay_seconds = ?,
      auto_continue_fail_count = 0,
      auto_continue_last_summary = ?,
      auto_continue_last_error = '',
      auto_continue_stop_requested = 0,
      runtime_updated_at = ?
    WHERE id = ? AND auto_continue_stop_requested = 0
  `).run(nextRunAt, delay, summary || '', now, sessionId);
  return getSessionAutoContinue(sessionId);
}

export function markSessionAutoContinueRunning(sessionId: string): SessionAutoContinueState | null {
  const now = nowSql();
  getDb().prepare(`
    UPDATE chat_sessions
    SET auto_continue_status = 'running',
      auto_continue_next_run_at = NULL,
      auto_continue_round = auto_continue_round + 1,
      runtime_updated_at = ?
    WHERE id = ? AND auto_continue_enabled = 1 AND auto_continue_stop_requested = 0
  `).run(now, sessionId);
  return getSessionAutoContinue(sessionId);
}

export function stopSessionAutoContinue(sessionId: string, reason = ''): SessionAutoContinueState | null {
  const now = nowSql();
  getDb().prepare(`
    UPDATE chat_sessions
    SET auto_continue_enabled = 0,
      auto_continue_status = 'stopped',
      auto_continue_next_run_at = NULL,
      auto_continue_last_error = ?,
      auto_continue_stop_requested = 1,
      runtime_updated_at = ?
    WHERE id = ?
  `).run(reason, now, sessionId);
  return getSessionAutoContinue(sessionId);
}

export function recordSessionAutoContinueFailure(sessionId: string, error: string): SessionAutoContinueState | null {
  const current = getSessionAutoContinue(sessionId);
  const failCount = (current?.fail_count || 0) + 1;
  const shouldStop = failCount >= 3;
  const nextRunAt = shouldStop ? null : toSqlDate(Date.now() + 60_000);
  const now = nowSql();
  getDb().prepare(`
    UPDATE chat_sessions
    SET auto_continue_enabled = ?,
      auto_continue_status = ?,
      auto_continue_next_run_at = ?,
      auto_continue_fail_count = ?,
      auto_continue_last_error = ?,
      runtime_updated_at = ?
    WHERE id = ?
  `).run(shouldStop ? 0 : 1, shouldStop ? 'failed' : 'waiting', nextRunAt, failCount, error, now, sessionId);
  return getSessionAutoContinue(sessionId);
}

export function listDueSessionAutoContinues(now: string = nowSql()): SessionAutoContinueState[] {
  const rows = getDb().prepare(`
    SELECT id, auto_continue_enabled, auto_continue_status, auto_continue_next_run_at,
      auto_continue_delay_seconds, auto_continue_round, auto_continue_max_rounds,
      auto_continue_fail_count, auto_continue_last_summary, auto_continue_last_error,
      auto_continue_stop_requested
    FROM chat_sessions
    WHERE auto_continue_enabled = 1
      AND auto_continue_stop_requested = 0
      AND auto_continue_status = 'waiting'
      AND auto_continue_next_run_at IS NOT NULL
      AND auto_continue_next_run_at <= ?
    ORDER BY auto_continue_next_run_at ASC
    LIMIT 5
  `).all(now) as AutoContinueRow[];
  return rows.map(mapRow);
}
