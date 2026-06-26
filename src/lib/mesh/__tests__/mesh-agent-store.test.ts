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
  it('ensureSeed：工作室空时灌通用极简种子（队长 + 1 示例成员，零业务）', () => {
    const agents = listAgents(WS) // 触发 ensureSeed
    expect(agents.length).toBe(2)
    expect(agents.find((a) => a.role === 'leader')?.id).toBe('team.leader')
    const example = agents.find((a) => a.id === 'example.member')
    expect(example?.role).toBe('custom') // 纯标签,无业务角色
    expect(example?.enabled).toBe(true)
    expect(example?.workMode).toBe('active_loop')
  })

  it('listAgents({enabled}) 过滤停用', () => {
    setEnabled(WS, 'example.member', false)
    expect(listAgents(WS, { enabled: true }).find((a) => a.id === 'example.member')).toBeFalsy()
    expect(listAgents(WS).find((a) => a.id === 'example.member')).toBeTruthy() // 全列仍含
    setEnabled(WS, 'example.member', true) // 复原
  })

  it('upsert 改 prompt/model，保留 role/topics 不丢', () => {
    upsertAgent(WS, { id: 'example.member', systemPrompt: '新提示词', model: 'opus' })
    const a = getAgent(WS, 'example.member')!
    expect(a.systemPrompt).toBe('新提示词')
    expect(a.model).toBe('opus')
    expect(a.role).toBe('custom') // 未传则保留
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
    expect(listAgents(A).length).toBe(2) // 各自 seed 一套
    expect(listAgents(B).length).toBe(2)
    upsertAgent(A, { id: 'example.member', systemPrompt: 'A 的示例' })
    setEnabled(B, 'example.member', false)
    expect(getAgent(A, 'example.member')?.systemPrompt).toBe('A 的示例')
    expect(getAgent(B, 'example.member')?.systemPrompt).not.toBe('A 的示例') // B 不受 A 改动影响
    expect(listAgents(A, { enabled: true }).find((a) => a.id === 'example.member')).toBeTruthy() // A 的没被 B 停用波及
    expect(listAgents(B, { enabled: true }).find((a) => a.id === 'example.member')).toBeFalsy()
  })
})
