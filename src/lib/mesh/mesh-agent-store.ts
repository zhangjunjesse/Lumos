/**
 * Agent Registry 存储 —— agent 配置真源（设计 §150）。按 workshopId 隔离：每个工作室一套 agents。
 * db 该工作室空时从 MESH_DEFAULT_AGENTS（通用极简种子）seed。调度器/管家/UI 都读这里。
 */
import { getDb } from '@/lib/db/connection'
import { MESH_DEFAULT_AGENTS } from './mesh-default-agents'
import type { MeshAgentConfig, MeshAgentRole, MeshWorkMode } from './mesh-agent-config'

export interface StoredAgent extends MeshAgentConfig {
  topics: string[]
  interval: number
  enabled: boolean
  sortOrder: number
  workMode: MeshWorkMode
}

interface Row {
  id: string
  role: string
  system_prompt: string
  model: string
  mcp_json: string
  tool_json: string
  topics_json: string
  interval_sec: number
  enabled: number
  sort_order: number
  work_mode: string
  provider_id: string
}

function toAgent(r: Row): StoredAgent {
  return {
    id: r.id,
    role: r.role as MeshAgentRole,
    systemPrompt: r.system_prompt,
    model: r.model || undefined,
    providerId: r.provider_id || undefined,
    mcpAllowlist: safeArr(r.mcp_json),
    toolAllowlist: safeArr(r.tool_json),
    topics: safeArr(r.topics_json),
    interval: r.interval_sec,
    enabled: r.enabled !== 0,
    sortOrder: r.sort_order,
    workMode: (r.work_mode as MeshWorkMode) || 'event_driven',
  }
}

/** 该工作室无 agent 时灌入默认种子（幂等，per-workshop）。 */
export function ensureSeed(workshopId: string): void {
  const db = getDb()
  const cnt = db.prepare('SELECT COUNT(*) AS c FROM mesh_agent WHERE workshop_id = ?').get(workshopId) as { c: number }
  if (cnt.c > 0) return
  const ins = db.prepare(
    `INSERT OR IGNORE INTO mesh_agent
       (id, role, system_prompt, model, mcp_json, tool_json, topics_json, interval_sec, enabled, sort_order, work_mode, provider_id, workshop_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  MESH_DEFAULT_AGENTS.forEach((a, i) =>
    ins.run(a.id, a.role, a.systemPrompt, a.model ?? '', JSON.stringify(a.mcpAllowlist), JSON.stringify(a.toolAllowlist), JSON.stringify(a.topics), a.interval, a.enabled ? 1 : 0, i, a.workMode, a.providerId ?? '', workshopId),
  )
}

export function listAgents(workshopId: string, opts: { enabled?: boolean } = {}): StoredAgent[] {
  ensureSeed(workshopId)
  const where = opts.enabled ? ' AND enabled = 1' : ''
  const rows = getDb().prepare(`SELECT * FROM mesh_agent WHERE workshop_id = ?${where} ORDER BY sort_order`).all(workshopId) as Row[]
  return rows.map(toAgent)
}

export function getAgent(workshopId: string, id: string): StoredAgent | null {
  ensureSeed(workshopId)
  const r = getDb().prepare('SELECT * FROM mesh_agent WHERE workshop_id = ? AND id = ?').get(workshopId, id) as Row | undefined
  return r ? toAgent(r) : null
}

/** agent 在该工作室是否已存在（route 区分新增/编辑用）。 */
export function agentExists(workshopId: string, id: string): boolean {
  const r = getDb().prepare('SELECT 1 FROM mesh_agent WHERE workshop_id = ? AND id = ?').get(workshopId, id)
  return !!r
}

export function upsertAgent(workshopId: string, patch: Partial<StoredAgent> & { id: string }): StoredAgent {
  ensureSeed(workshopId)
  const cur = getAgent(workshopId, patch.id)
  const next: StoredAgent = {
    id: patch.id,
    role: patch.role ?? cur?.role ?? 'custom',
    systemPrompt: patch.systemPrompt ?? cur?.systemPrompt ?? '',
    model: patch.model ?? cur?.model,
    providerId: patch.providerId ?? cur?.providerId,
    mcpAllowlist: patch.mcpAllowlist ?? cur?.mcpAllowlist ?? [],
    toolAllowlist: patch.toolAllowlist ?? cur?.toolAllowlist ?? [],
    topics: patch.topics ?? cur?.topics ?? [],
    interval: patch.interval ?? cur?.interval ?? 10,
    enabled: patch.enabled ?? cur?.enabled ?? true,
    sortOrder: patch.sortOrder ?? cur?.sortOrder ?? 99,
    workMode: patch.workMode ?? cur?.workMode ?? 'event_driven',
  }
  getDb()
    .prepare(
      `INSERT INTO mesh_agent
         (id, role, system_prompt, model, mcp_json, tool_json, topics_json, interval_sec, enabled, sort_order, work_mode, provider_id, workshop_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(workshop_id, id) DO UPDATE SET
         role=excluded.role, system_prompt=excluded.system_prompt, model=excluded.model,
         mcp_json=excluded.mcp_json, tool_json=excluded.tool_json, topics_json=excluded.topics_json,
         interval_sec=excluded.interval_sec, enabled=excluded.enabled, sort_order=excluded.sort_order,
         work_mode=excluded.work_mode, provider_id=excluded.provider_id, updated_at=datetime('now')`,
    )
    .run(
      next.id,
      next.role,
      next.systemPrompt,
      next.model ?? '',
      JSON.stringify(next.mcpAllowlist),
      JSON.stringify(next.toolAllowlist),
      JSON.stringify(next.topics),
      next.interval,
      next.enabled ? 1 : 0,
      next.sortOrder,
      next.workMode,
      next.providerId ?? '',
      workshopId,
    )
  return next
}

export function setEnabled(workshopId: string, id: string, enabled: boolean): void {
  ensureSeed(workshopId)
  getDb().prepare(`UPDATE mesh_agent SET enabled = ?, updated_at = datetime('now') WHERE workshop_id = ? AND id = ?`).run(enabled ? 1 : 0, workshopId, id)
}

export function deleteAgent(workshopId: string, id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM mesh_agent WHERE workshop_id = ? AND id = ?').run(workshopId, id)
  // 同步清 MCP 状态，免得同 id 重建的新 agent 继承上一个的旧"已连"状态。
  db.prepare('DELETE FROM mesh_mcp_status WHERE workshop_id = ? AND agent_id = ?').run(workshopId, id)
}

function safeArr(json: string): string[] {
  try {
    const a = JSON.parse(json)
    return Array.isArray(a) ? a.map(String) : []
  } catch {
    return []
  }
}
