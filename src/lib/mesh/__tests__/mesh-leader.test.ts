/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

// applyCommands 是确定性的、不调 SDK；mock 掉 worker 避免加载真 Claude SDK
jest.mock('../mesh-worker', () => ({ runMeshAgentStructured: jest.fn() }))

import { applyCommands } from '../mesh-leader'
import { getTeamConfig } from '../mesh-team-config'
import { getDb } from '@/lib/db/connection'

describe('applyCommands (Control Plane)', () => {
  it('确定性应用命令到 config + 审计落盘 + 放宽标记', () => {
    const { applied, config } = applyCommands('只看不买，别碰600160', [
      { type: 'set_mode', mode: 'observe_only' },
      { type: 'set_blacklist', symbols: ['600160.SH'], add: true },
    ])
    expect(config.mode).toBe('observe_only')
    expect(config.blacklist).toContain('600160.SH')
    expect(applied).toHaveLength(2)
    expect(applied.every((a) => a.relaxesRisk === false)).toBe(true) // 收紧不算放宽
    expect(getTeamConfig().mode).toBe('observe_only') // 已落盘

    const audit = getDb().prepare('SELECT COUNT(*) AS c FROM mesh_command').get() as { c: number }
    expect(audit.c).toBe(2)
  })

  it('放宽风险命令（切回 auto）标 relaxesRisk + 落盘 relaxes_risk=1', () => {
    const { applied } = applyCommands('恢复自动交易', [{ type: 'set_mode', mode: 'auto' }])
    expect(applied[0].relaxesRisk).toBe(true)
    const row = getDb()
      .prepare("SELECT relaxes_risk AS r FROM mesh_command WHERE command_json LIKE '%\"auto\"%' ORDER BY created_at DESC LIMIT 1")
      .get() as { r: number }
    expect(row.r).toBe(1)
  })
})
