/**
 * mesh_participant DAO —— 每个 agent 在一个常驻 session 里的运行态（设计 §430）。
 * 一行 = 一个 (runId, participantId)：work_mode、next_run_at/last_run_at(epoch ms)、
 * state/backlog(json)、idle_streak(空转退避)、cycle_seq(下单幂等键用，持久自增防重启撞 key)。
 * 纯 SQLite，调度器据此选「该跑谁」。不 import agent-store（initParticipants 收参数，避免循环）。
 */
import { getDb } from '@/lib/db/connection'
import type { MeshWorkMode } from './mesh-agent-config'

export type ParticipantStatus = 'idle' | 'running' | 'paused' | 'failed'

export interface StoredParticipant {
  runId: string
  participantId: string
  role: string
  subscriptions: string[]
  workMode: MeshWorkMode
  status: ParticipantStatus
  state: Record<string, unknown>
  backlog: unknown[]
  nextRunAt: number | null
  lastRunAt: number | null
  idleStreak: number
  cycleSeq: number
}

interface Row {
  run_id: string
  participant_id: string
  role: string
  subscriptions_json: string
  work_mode: string
  status: string
  state_json: string
  backlog_json: string
  next_run_at: number | null
  last_run_at: number | null
  idle_streak: number
  cycle_seq: number
}

function toParticipant(r: Row): StoredParticipant {
  return {
    runId: r.run_id,
    participantId: r.participant_id,
    role: r.role,
    subscriptions: safeArr(r.subscriptions_json),
    workMode: (r.work_mode as MeshWorkMode) || 'event_driven',
    status: (r.status as ParticipantStatus) || 'idle',
    state: safeObj(r.state_json),
    backlog: safeArrAny(r.backlog_json),
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at,
    idleStreak: r.idle_streak,
    cycleSeq: r.cycle_seq,
  }
}

export interface ParticipantSeed {
  participantId: string
  role: string
  subscriptions: string[]
  workMode: MeshWorkMode
}

/** 建参与者行（一个 session 一次）：active_loop 的 next_run_at=now（立即可跑），event_driven 不主动跑(null)。 */
export function initParticipants(runId: string, seeds: ParticipantSeed[], now: number): void {
  const db = getDb()
  const ins = db.prepare(
    `INSERT OR IGNORE INTO mesh_participant (run_id, participant_id, role, subscriptions_json, work_mode, next_run_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  db.transaction(() => {
    for (const s of seeds) {
      ins.run(runId, s.participantId, s.role, JSON.stringify(s.subscriptions), s.workMode, s.workMode === 'active_loop' ? now : null)
    }
  })()
}

/** 选主动到点的 agent：active_loop + 非 paused + next_run_at<=now。事件触发不走这里（走 pending delivery）。 */
export function queryDueParticipants(runId: string, now: number): StoredParticipant[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM mesh_participant
       WHERE run_id = ? AND work_mode = 'active_loop' AND status != 'paused'
         AND next_run_at IS NOT NULL AND next_run_at <= ?
       ORDER BY next_run_at`,
    )
    .all(runId, now) as Row[]
  return rows.map(toParticipant)
}

export function getParticipant(runId: string, participantId: string): StoredParticipant | null {
  const r = getDb()
    .prepare(`SELECT * FROM mesh_participant WHERE run_id = ? AND participant_id = ?`)
    .get(runId, participantId) as Row | undefined
  return r ? toParticipant(r) : null
}

export function listParticipants(runId: string): StoredParticipant[] {
  const rows = getDb().prepare(`SELECT * FROM mesh_participant WHERE run_id = ?`).all(runId) as Row[]
  return rows.map(toParticipant)
}

export interface ParticipantPatch {
  nextRunAt?: number | null
  lastRunAt?: number
  state?: Record<string, unknown>
  backlog?: unknown[]
  idleStreak?: number
  status?: ParticipantStatus
}

/** 局部更新运行态（动态 SET，列名硬编码、值参数化）。 */
export function updateParticipant(runId: string, participantId: string, patch: ParticipantPatch): void {
  const sets: string[] = []
  const vals: unknown[] = []
  if (patch.nextRunAt !== undefined) {
    sets.push('next_run_at = ?')
    vals.push(patch.nextRunAt)
  }
  if (patch.lastRunAt !== undefined) {
    sets.push('last_run_at = ?')
    vals.push(patch.lastRunAt)
  }
  if (patch.state !== undefined) {
    sets.push('state_json = ?')
    vals.push(JSON.stringify(patch.state))
  }
  if (patch.backlog !== undefined) {
    sets.push('backlog_json = ?')
    vals.push(JSON.stringify(patch.backlog))
  }
  if (patch.idleStreak !== undefined) {
    sets.push('idle_streak = ?')
    vals.push(patch.idleStreak)
  }
  if (patch.status !== undefined) {
    sets.push('status = ?')
    vals.push(patch.status)
  }
  if (sets.length === 0) return
  vals.push(runId, participantId)
  getDb()
    .prepare(`UPDATE mesh_participant SET ${sets.join(', ')} WHERE run_id = ? AND participant_id = ?`)
    .run(...vals)
}

/** 持久自增 cycle_seq 并返回新值（下单幂等键用；进程重启不重置，防同 key 吞新单）。单线程串行无竞态。 */
export function nextCycleSeq(runId: string, participantId: string): number {
  const db = getDb()
  return db.transaction(() => {
    const r = db
      .prepare(`SELECT cycle_seq FROM mesh_participant WHERE run_id = ? AND participant_id = ?`)
      .get(runId, participantId) as { cycle_seq: number } | undefined
    const next = (r?.cycle_seq ?? 0) + 1
    db.prepare(`UPDATE mesh_participant SET cycle_seq = ? WHERE run_id = ? AND participant_id = ?`).run(next, runId, participantId)
    return next
  })()
}

/** 删除该 session 全部参与者行（stop / reconcile 清孤儿用；§75 不做进程挂起恢复）。 */
export function deleteByRun(runId: string): number {
  return getDb().prepare(`DELETE FROM mesh_participant WHERE run_id = ?`).run(runId).changes
}

function safeArr(json: string): string[] {
  try {
    const a = JSON.parse(json)
    return Array.isArray(a) ? a.map(String) : []
  } catch {
    return []
  }
}

function safeArrAny(json: string): unknown[] {
  try {
    const a = JSON.parse(json)
    return Array.isArray(a) ? a : []
  } catch {
    return []
  }
}

function safeObj(json: string): Record<string, unknown> {
  try {
    const o = JSON.parse(json)
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch {
    return {}
  }
}
