/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

import { listWorkshops, getWorkshop, createWorkshop, updateWorkshop, deleteWorkshopRow, DEFAULT_WORKSHOP_ID } from '../mesh-workshop-store'

describe('mesh-workshop-store —— 工作室 CRUD（W1）', () => {
  it('migrate 后种出默认工作室（id=DEFAULT_WORKSHOP_ID，零迁移归它）', () => {
    expect(DEFAULT_WORKSHOP_ID).toBe('mesh_team_default')
    const def = getWorkshop(DEFAULT_WORKSHOP_ID)
    expect(def).not.toBeNull()
    expect(def!.name).toBe('默认工作室')
  })

  it('createWorkshop 建行（自动 ws_ id）+ list/get 往返', () => {
    const w = createWorkshop({ name: '低吸打板', description: '盯涨停回踩' })
    expect(w.id).toMatch(/^ws_/)
    expect(w.name).toBe('低吸打板')
    expect(w.status).toBe('active')
    expect(getWorkshop(w.id)?.description).toBe('盯涨停回踩')
    expect(listWorkshops().map((x) => x.id)).toContain(w.id)
  })

  it('createWorkshop 可指定 id', () => {
    const w = createWorkshop({ name: 'X', id: 'ws_fixed' })
    expect(w.id).toBe('ws_fixed')
  })

  it('updateWorkshop 局部改名/描述/状态', () => {
    const w = createWorkshop({ name: '原名' })
    updateWorkshop(w.id, { name: '新名', status: 'paused' })
    const g = getWorkshop(w.id)!
    expect(g.name).toBe('新名')
    expect(g.status).toBe('paused')
  })

  it('deleteWorkshopRow 删行', () => {
    const w = createWorkshop({ name: '待删' })
    expect(deleteWorkshopRow(w.id)).toBe(1)
    expect(getWorkshop(w.id)).toBeNull()
  })
})
