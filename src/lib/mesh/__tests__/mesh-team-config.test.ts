/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

import { getTeamConfig, upsertTeamConfig } from '../mesh-team-config'
import { DEFAULT_WORKSHOP_ID } from '../mesh-constants'

const WS = DEFAULT_WORKSHOP_ID

describe('mesh-team-config（按 workshopId 隔离）', () => {
  it('默认配置（无行）', () => {
    expect(getTeamConfig('ws_empty')).toEqual({ blacklist: [], focus: '', mode: 'auto', tradeMode: 'paper', watchlist: [] })
  })

  it('tradeMode 默认 paper，可 upsert 成 live 且不串其它字段', () => {
    expect(getTeamConfig('ws_tm').tradeMode).toBe('paper')
    upsertTeamConfig('ws_tm', { tradeMode: 'live' })
    expect(getTeamConfig('ws_tm').tradeMode).toBe('live')
    upsertTeamConfig('ws_tm', { focus: 'x' })
    expect(getTeamConfig('ws_tm').tradeMode).toBe('live') // focus 改不动 tradeMode
  })

  it('upsert 单字段不覆盖其它字段', () => {
    upsertTeamConfig(WS, { mode: 'observe_only' })
    expect(getTeamConfig(WS).mode).toBe('observe_only')
    upsertTeamConfig(WS, { blacklist: ['600160.SH'] })
    const c = getTeamConfig(WS)
    expect(c.blacklist).toEqual(['600160.SH'])
    expect(c.mode).toBe('observe_only')
  })

  it('两工作室 config 互不串', () => {
    upsertTeamConfig('ws_x', { focus: '半导体' })
    upsertTeamConfig('ws_y', { focus: '医药' })
    expect(getTeamConfig('ws_x').focus).toBe('半导体')
    expect(getTeamConfig('ws_y').focus).toBe('医药')
  })
})
