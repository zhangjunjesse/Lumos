/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

import { getTeamConfig, upsertTeamConfig } from '../mesh-team-config'

describe('mesh-team-config', () => {
  it('默认配置（无行）', () => {
    expect(getTeamConfig()).toEqual({ blacklist: [], focus: '', mode: 'auto' })
  })

  it('upsert 单字段不覆盖其它字段', () => {
    upsertTeamConfig({ mode: 'observe_only' })
    expect(getTeamConfig().mode).toBe('observe_only')
    upsertTeamConfig({ blacklist: ['600160.SH'] })
    const c = getTeamConfig()
    expect(c.blacklist).toEqual(['600160.SH'])
    expect(c.mode).toBe('observe_only')
  })
})
