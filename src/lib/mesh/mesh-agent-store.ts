/**
 * Agent Registry 存储 —— agent 配置真源（设计 §150）。db 空时从 MESH_DEFAULT_AGENTS seed。
 * 协作（mesh-collaboration）和队长（mesh-leader）读这里，不再用硬编码。
 */
import { getDb } from '@/lib/db/connection'
import { MESH_DEFAULT_AGENTS } from './mesh-stock-agents'
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
}

function toAgent(r: Row): StoredAgent {
  return {
    id: r.id,
    role: r.role as MeshAgentRole,
    systemPrompt: r.system_prompt,
    model: r.model || undefined,
    mcpAllowlist: safeArr(r.mcp_json),
    toolAllowlist: safeArr(r.tool_json),
    topics: safeArr(r.topics_json),
    interval: r.interval_sec,
    enabled: r.enabled !== 0,
    sortOrder: r.sort_order,
    workMode: (r.work_mode as MeshWorkMode) || 'event_driven',
  }
}

/** db 空时灌入默认 5 个 agent（幂等）。 */
export function ensureSeed(): void {
  const db = getDb()
  const cnt = db.prepare('SELECT COUNT(*) AS c FROM mesh_agent').get() as { c: number }
  if (cnt.c > 0) return
  const ins = db.prepare(
    `INSERT OR IGNORE INTO mesh_agent
       (id, role, system_prompt, model, mcp_json, tool_json, topics_json, interval_sec, enabled, sort_order, work_mode)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  MESH_DEFAULT_AGENTS.forEach((a, i) =>
    ins.run(a.id, a.role, a.systemPrompt, a.model ?? '', JSON.stringify(a.mcpAllowlist), JSON.stringify(a.toolAllowlist), JSON.stringify(a.topics), a.interval, a.enabled ? 1 : 0, i, a.workMode),
  )
}

export function listAgents(opts: { enabled?: boolean } = {}): StoredAgent[] {
  ensureSeed()
  const where = opts.enabled ? ' WHERE enabled = 1' : ''
  const rows = getDb().prepare(`SELECT * FROM mesh_agent${where} ORDER BY sort_order`).all() as Row[]
  return rows.map(toAgent)
}

export function getAgent(id: string): StoredAgent | null {
  ensureSeed()
  const r = getDb().prepare('SELECT * FROM mesh_agent WHERE id = ?').get(id) as Row | undefined
  return r ? toAgent(r) : null
}

export function upsertAgent(patch: Partial<StoredAgent> & { id: string }): StoredAgent {
  ensureSeed()
  const cur = getAgent(patch.id)
  const next: StoredAgent = {
    id: patch.id,
    role: patch.role ?? cur?.role ?? 'observe',
    systemPrompt: patch.systemPrompt ?? cur?.systemPrompt ?? '',
    model: patch.model ?? cur?.model,
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
         (id, role, system_prompt, model, mcp_json, tool_json, topics_json, interval_sec, enabled, sort_order, work_mode, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         role=excluded.role, system_prompt=excluded.system_prompt, model=excluded.model,
         mcp_json=excluded.mcp_json, tool_json=excluded.tool_json, topics_json=excluded.topics_json,
         interval_sec=excluded.interval_sec, enabled=excluded.enabled, sort_order=excluded.sort_order,
         work_mode=excluded.work_mode, updated_at=datetime('now')`,
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
    )
  return next
}

export function setEnabled(id: string, enabled: boolean): void {
  ensureSeed()
  getDb().prepare(`UPDATE mesh_agent SET enabled = ?, updated_at = datetime('now') WHERE id = ?`).run(enabled ? 1 : 0, id)
}

export function deleteAgent(id: string): void {
  getDb().prepare('DELETE FROM mesh_agent WHERE id = ?').run(id)
}

function safeArr(json: string): string[] {
  try {
    const a = JSON.parse(json)
    return Array.isArray(a) ? a.map(String) : []
  } catch {
    return []
  }
}
