/**
 * 网状协作白板 —— 共享状态 + 留痕。
 * 同一 (run_id, key) 每次写都自增 version、保留历史；读取默认取最新版本。
 */
import { getDb } from '@/lib/db/connection'

export interface BlackboardEntry {
  key: string
  value: unknown
  version: number
  writtenBy: string
  writtenAt: string
}

interface BlackboardRow {
  key: string
  value_json: string
  version: number
  written_by: string
  written_at: string
}

/** 写白板：version 自增、留痕。返回新版本号。（在 outbox 事务内调用以保证原子性）*/
export function writeBlackboard(runId: string, key: string, value: unknown, writtenBy: string): number {
  const db = getDb()
  const row = db
    .prepare('SELECT MAX(version) AS v FROM mesh_blackboard WHERE run_id = ? AND key = ?')
    .get(runId, key) as { v: number | null } | undefined
  const version = (row?.v ?? 0) + 1
  db.prepare(
    `INSERT INTO mesh_blackboard (run_id, key, version, value_json, written_by)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(runId, key, version, JSON.stringify(value ?? null), writtenBy)
  return version
}

/** 读某 key 的最新版本。 */
export function readBlackboard(runId: string, key: string): BlackboardEntry | null {
  const row = getDb()
    .prepare(
      `SELECT key, value_json, version, written_by, written_at
       FROM mesh_blackboard WHERE run_id = ? AND key = ?
       ORDER BY version DESC LIMIT 1`,
    )
    .get(runId, key) as BlackboardRow | undefined
  return row ? hydrate(row) : null
}

/** 读某 run 全部 key 的最新版本（复盘/上下文用）。 */
export function readAllBlackboard(runId: string): BlackboardEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT b.key, b.value_json, b.version, b.written_by, b.written_at
       FROM mesh_blackboard b
       JOIN (SELECT key, MAX(version) AS v FROM mesh_blackboard WHERE run_id = ? GROUP BY key) m
         ON b.key = m.key AND b.version = m.v
       WHERE b.run_id = ?
       ORDER BY b.written_at`,
    )
    .all(runId, runId) as BlackboardRow[]
  return rows.map(hydrate)
}

function hydrate(row: BlackboardRow): BlackboardEntry {
  return {
    key: row.key,
    value: safeParse(row.value_json),
    version: row.version,
    writtenBy: row.written_by,
    writtenAt: row.written_at,
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
