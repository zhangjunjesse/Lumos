/**
 * 工作室 DAO —— mesh_workshop 表（多团队隔离的顶层实体）。
 * workshopId 复用 accountId 维度：一个工作室 = 一个账户 = 一套独立 agents/config/risk。
 * 这里只做行级 CRUD；删工作室的「停 runner + 级联删配置/历史」在 lifecycle service（W5），不在 store。
 */
import { randomUUID } from 'crypto'
import { getDb } from '@/lib/db/connection'

export { DEFAULT_WORKSHOP_ID } from './mesh-constants'

export type WorkshopStatus = 'active' | 'paused' | 'draft'

export interface Workshop {
  id: string
  name: string
  description: string
  status: WorkshopStatus
  createdAt: string
}

interface Row {
  id: string
  name: string
  description: string
  status: string
  created_at: string
}

function toWorkshop(r: Row): Workshop {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    status: (r.status as WorkshopStatus) || 'active',
    createdAt: r.created_at,
  }
}

export function listWorkshops(): Workshop[] {
  const rows = getDb().prepare(`SELECT * FROM mesh_workshop ORDER BY created_at`).all() as Row[]
  return rows.map(toWorkshop)
}

export function getWorkshop(id: string): Workshop | null {
  const r = getDb().prepare(`SELECT * FROM mesh_workshop WHERE id = ?`).get(id) as Row | undefined
  return r ? toWorkshop(r) : null
}

/** 建工作室行（id 缺省生成 ws_<uuid>）。默认 agents/config/risk 的 seed 由调用方在 W3/W4 接入。 */
export function createWorkshop(input: { name: string; description?: string; id?: string; status?: WorkshopStatus }): Workshop {
  const id = input.id ?? `ws_${randomUUID()}`
  getDb()
    .prepare(`INSERT INTO mesh_workshop (id, name, description, status) VALUES (?, ?, ?, ?)`)
    .run(id, input.name, input.description ?? '', input.status ?? 'active')
  return getWorkshop(id)!
}

export function updateWorkshop(id: string, patch: { name?: string; description?: string; status?: WorkshopStatus }): void {
  const sets: string[] = []
  const vals: unknown[] = []
  if (patch.name !== undefined) {
    sets.push('name = ?')
    vals.push(patch.name)
  }
  if (patch.description !== undefined) {
    sets.push('description = ?')
    vals.push(patch.description)
  }
  if (patch.status !== undefined) {
    sets.push('status = ?')
    vals.push(patch.status)
  }
  if (sets.length === 0) return
  sets.push(`updated_at = datetime('now')`)
  vals.push(id)
  getDb().prepare(`UPDATE mesh_workshop SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

/** 仅删 mesh_workshop 行；配置/历史的级联删在 lifecycle service（W5）。 */
export function deleteWorkshopRow(id: string): number {
  return getDb().prepare(`DELETE FROM mesh_workshop WHERE id = ?`).run(id).changes
}
