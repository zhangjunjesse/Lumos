/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

import { listAgents, getAgent, upsertAgent, setEnabled, deleteAgent } from '../mesh-agent-store'
import { DEFAULT_WORKSHOP_ID } from '../mesh-constants'

const WS = DEFAULT_WORKSHOP_ID

describe('mesh-agent-store（Agent Registry，按 workshopId 隔离）', () => {
  it('ensureSeed：工作室空时灌默认 5 个（1 队长 + 4 协作）', () => {
    const agents = listAgents(WS) // 触发 ensureSeed
    expect(agents.length).toBe(5)
    expect(agents.find((a) => a.role === 'leader')?.id).toBe('team.leader')
    expect(agents.filter((a) => a.role !== 'leader').map((a) => a.role).sort()).toEqual(['decide', 'observe', 'review', 'risk'])
    expect(agents.find((a) => a.role === 'decide')?.topics).toEqual(['quote_anomaly'])
  })

  it('listAgents({enabled}) 过滤停用', () => {
    setEnabled(WS, 'stock.decide', false)
    expect(listAgents(WS, { enabled: true }).find((a) => a.id === 'stock.decide')).toBeFalsy()
    expect(listAgents(WS).find((a) => a.id === 'stock.decide')).toBeTruthy() // 全列仍含
    setEnabled(WS, 'stock.decide', true) // 复原
  })

  it('upsert 改 prompt/model，保留 role/topics 不丢', () => {
    upsertAgent(WS, { id: 'stock.observe', systemPrompt: '新盯盘提示词', model: 'opus' })
    const a = getAgent(WS, 'stock.observe')!
    expect(a.systemPrompt).toBe('新盯盘提示词')
    expect(a.model).toBe('opus')
    expect(a.role).toBe('observe') // 未传则保留
    expect(a.topics).toEqual([])
  })

  it('新增 + 删除自定义 agent', () => {
    upsertAgent(WS, { id: 'custom.news', role: 'research', systemPrompt: '盯新闻', mcpAllowlist: [], toolAllowlist: [], topics: ['news'], interval: 30, enabled: true })
    expect(getAgent(WS, 'custom.news')?.topics).toEqual(['news'])
    deleteAgent(WS, 'custom.news')
    expect(getAgent(WS, 'custom.news')).toBeNull()
  })

  it('两工作室各一套 agents，互不串（改 A 不影响 B）', () => {
    const A = 'ws_a'
    const B = 'ws_b'
    expect(listAgents(A).length).toBe(5) // 各自 seed 一套
    expect(listAgents(B).length).toBe(5)
    upsertAgent(A, { id: 'stock.observe', systemPrompt: 'A 的盯盘' })
    setEnabled(B, 'stock.risk', false)
    expect(getAgent(A, 'stock.observe')?.systemPrompt).toBe('A 的盯盘')
    expect(getAgent(B, 'stock.observe')?.systemPrompt).not.toBe('A 的盯盘') // B 的 observe 不受 A 改动影响
    expect(listAgents(A, { enabled: true }).find((a) => a.id === 'stock.risk')).toBeTruthy() // A 的 risk 没被 B 停用波及
    expect(listAgents(B, { enabled: true }).find((a) => a.id === 'stock.risk')).toBeFalsy()
  })
})
