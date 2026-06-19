/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

import { listAgents, getAgent, upsertAgent, setEnabled, deleteAgent } from '../mesh-agent-store'

describe('mesh-agent-store（Agent Registry）', () => {
  it('ensureSeed：db 空时灌默认 5 个（1 队长 + 4 协作）', () => {
    const agents = listAgents() // 触发 ensureSeed
    expect(agents.length).toBe(5)
    expect(agents.find((a) => a.role === 'leader')?.id).toBe('team.leader')
    expect(agents.filter((a) => a.role !== 'leader').map((a) => a.role).sort()).toEqual(['decide', 'observe', 'review', 'risk'])
    // topics 也 seed 进去（决策订 quote_anomaly、风控订 order_proposal）
    expect(agents.find((a) => a.role === 'decide')?.topics).toEqual(['quote_anomaly'])
  })

  it('listAgents({enabled}) 过滤停用', () => {
    setEnabled('stock.decide', false)
    expect(listAgents({ enabled: true }).find((a) => a.id === 'stock.decide')).toBeFalsy()
    expect(listAgents().find((a) => a.id === 'stock.decide')).toBeTruthy() // 全列仍含
    setEnabled('stock.decide', true) // 复原
  })

  it('upsert 改 prompt/model，保留 role/topics 不丢', () => {
    upsertAgent({ id: 'stock.observe', systemPrompt: '新盯盘提示词', model: 'opus' })
    const a = getAgent('stock.observe')!
    expect(a.systemPrompt).toBe('新盯盘提示词')
    expect(a.model).toBe('opus')
    expect(a.role).toBe('observe') // 未传则保留
    expect(a.topics).toEqual([])
  })

  it('新增 + 删除自定义 agent', () => {
    upsertAgent({ id: 'custom.news', role: 'research', systemPrompt: '盯新闻', mcpAllowlist: [], toolAllowlist: [], topics: ['news'], interval: 30, enabled: true })
    expect(getAgent('custom.news')?.topics).toEqual(['news'])
    deleteAgent('custom.news')
    expect(getAgent('custom.news')).toBeNull()
  })
})
