/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

import { listMeshMcpServers } from '../mesh-agent-config'
import { teamTrades } from '../mesh-session-context'
import { upsertAgent, setEnabled } from '../mesh-agent-store'
import { MESH_TRADE_MCP_SERVER_NAME } from '../mesh-constants'

describe('mesh 下单能力 opt-in（T10）', () => {
  it('listMeshMcpServers 把 mesh-trade 列为可授的内置能力（qmt-readonly 是 stdio 非内置）', () => {
    const opts = listMeshMcpServers()
    const trade = opts.find((o) => o.name === MESH_TRADE_MCP_SERVER_NAME)
    expect(trade).toBeTruthy()
    expect(trade?.builtin).toBe(true)
    expect(opts.find((o) => o.name === 'qmt-readonly')?.builtin).toBeFalsy()
  })

  it('teamTrades：有 enabled 成员含 mesh-trade → true；停用/没有 → false', () => {
    const WS = 'ws_trade_detect'
    expect(teamTrades(WS)).toBe(false) // 默认种子(队长 + 示例成员)无下单
    upsertAgent(WS, { id: 'trader', role: 'custom', systemPrompt: '', mcpAllowlist: [MESH_TRADE_MCP_SERVER_NAME], toolAllowlist: [], topics: [], interval: 60, enabled: true, workMode: 'active_loop' })
    expect(teamTrades(WS)).toBe(true)
    setEnabled(WS, 'trader', false) // 停用后按 enabled 过滤 → 不再算交易团队
    expect(teamTrades(WS)).toBe(false)
  })
})
