/**
 * 团队配置 —— 按 workshopId 隔离（每个工作室一份）。Leader 命令经 Control Plane 改这里，协作据此调整。
 * blacklist：黑名单 symbol；focus：关注重点；mode：auto(可下单) / observe_only(只看不买)。
 */
import { getDb } from '@/lib/db/connection'

export type TeamMode = 'auto' | 'observe_only'

export interface TeamConfig {
  blacklist: string[]
  focus: string
  mode: TeamMode
}

const DEFAULT_ID = 'default'
const DEFAULTS: TeamConfig = { blacklist: [], focus: '', mode: 'auto' }

export function getTeamConfig(workshopId: string): TeamConfig {
  const row = getDb()
    .prepare('SELECT blacklist_json, focus, mode FROM mesh_team_config WHERE workshop_id = ? AND id = ?')
    .get(workshopId, DEFAULT_ID) as { blacklist_json: string; focus: string; mode: TeamMode } | undefined
  if (!row) return { ...DEFAULTS }
  return { blacklist: safeArr(row.blacklist_json), focus: row.focus, mode: row.mode }
}

export function upsertTeamConfig(workshopId: string, patch: Partial<TeamConfig>): TeamConfig {
  const cur = getTeamConfig(workshopId)
  const next: TeamConfig = {
    blacklist: patch.blacklist ?? cur.blacklist,
    focus: patch.focus ?? cur.focus,
    mode: patch.mode ?? cur.mode,
  }
  getDb()
    .prepare(
      `INSERT INTO mesh_team_config (id, blacklist_json, focus, mode, workshop_id, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(workshop_id, id) DO UPDATE SET
         blacklist_json=excluded.blacklist_json, focus=excluded.focus,
         mode=excluded.mode, updated_at=datetime('now')`,
    )
    .run(DEFAULT_ID, JSON.stringify(next.blacklist), next.focus, next.mode, workshopId)
  return next
}

function safeArr(json: string): string[] {
  try {
    const a = JSON.parse(json)
    return Array.isArray(a) ? a.map(String) : []
  } catch {
    return []
  }
}
