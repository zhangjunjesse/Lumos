/**
 * mesh_run DAO —— 常驻盯盘运行记录（审计 + 清孤儿依据）。
 * 一个 account 同时至多一条 running；rounds 累计跑了几轮。纯 SQLite。
 */
import { randomUUID } from 'crypto'
import { getDb } from '@/lib/db/connection'

export interface MeshRunRow {
  id: string
  accountId: string
  status: 'running' | 'stopped'
  rounds: number
  intervalMs: number
  lastRunId: string | null
  lastError: string | null
  startedAt: string
  stoppedAt: string | null
}

interface RawRow {
  id: string
  account_id: string
  status: 'running' | 'stopped'
  rounds: number
  interval_ms: number
  last_run_id: string | null
  last_error: string | null
  started_at: string
  stopped_at: string | null
}

function toRow(r: RawRow): MeshRunRow {
  return {
    id: r.id,
    accountId: r.account_id,
    status: r.status,
    rounds: r.rounds,
    intervalMs: r.interval_ms,
    lastRunId: r.last_run_id,
    lastError: r.last_error,
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
  }
}

export function createRun(accountId: string, intervalMs: number): MeshRunRow {
  const id = `mctl_${randomUUID()}`
  getDb()
    .prepare(`INSERT INTO mesh_run (id, account_id, status, interval_ms) VALUES (?, ?, 'running', ?)`)
    .run(id, accountId, intervalMs)
  return getRun(id)!
}

export function getRun(id: string): MeshRunRow | null {
  const r = getDb().prepare(`SELECT * FROM mesh_run WHERE id = ?`).get(id) as RawRow | undefined
  return r ? toRow(r) : null
}

/** 该账户当前的 running 记录（至多一条）。 */
export function getRunningRun(accountId: string): MeshRunRow | null {
  const r = getDb()
    .prepare(`SELECT * FROM mesh_run WHERE account_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`)
    .get(accountId) as RawRow | undefined
  return r ? toRow(r) : null
}

export function listRunningRuns(): MeshRunRow[] {
  const rows = getDb().prepare(`SELECT * FROM mesh_run WHERE status = 'running'`).all() as RawRow[]
  return rows.map(toRow)
}

export function recordRound(id: string, runId: string): void {
  getDb()
    .prepare(`UPDATE mesh_run SET rounds = rounds + 1, last_run_id = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(runId, id)
}

export function recordError(id: string, message: string): void {
  getDb()
    .prepare(`UPDATE mesh_run SET last_error = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(message, id)
}

/** 标记终态（幂等：仅当还在 running 时生效）。 */
export function markStopped(id: string): void {
  getDb()
    .prepare(
      `UPDATE mesh_run SET status = 'stopped', stopped_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND status = 'running'`,
    )
    .run(id)
}
