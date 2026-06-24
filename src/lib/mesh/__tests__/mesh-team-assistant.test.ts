/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})
jest.mock('../mesh-worker', () => ({ runMeshAgentStructured: jest.fn() }))

import { applyTeamActions } from '../mesh-team-assistant'
import { parseTeamAssistantResult } from '../mesh-team-action-schema'
import { getAgent } from '../mesh-agent-store'

describe('applyTeamActions —— 确定性应用(建/改直接,删 pending)', () => {
  it('create 新成员 → 落库', () => {
    const r = applyTeamActions([{ type: 'create_agent', id: 'custom.semi', role: 'custom', systemPrompt: '盯半导体' }], 'ws1')
    expect(r.applied).toContain('已创建 custom.semi')
    expect(getAgent('ws1', 'custom.semi')?.systemPrompt).toBe('盯半导体')
  })

  it('create 同 id → 跳过,不覆盖既有', () => {
    applyTeamActions([{ type: 'create_agent', id: 'dup', systemPrompt: 'a' }], 'ws2')
    const r = applyTeamActions([{ type: 'create_agent', id: 'dup', systemPrompt: 'b' }], 'ws2')
    expect(r.applied[0]).toContain('已存在')
    expect(getAgent('ws2', 'dup')?.systemPrompt).toBe('a')
  })

  it('update 现有 → 只改给的字段,其余保留', () => {
    applyTeamActions([{ type: 'create_agent', id: 'u1', systemPrompt: 'old', enabled: true }], 'ws3')
    const r = applyTeamActions([{ type: 'update_agent', id: 'u1', enabled: false }], 'ws3')
    expect(r.applied).toContain('已修改 u1')
    expect(getAgent('ws3', 'u1')?.enabled).toBe(false)
    expect(getAgent('ws3', 'u1')?.systemPrompt).toBe('old')
  })

  it('create 过滤幻觉 MCP（只留注册表里真有的）', () => {
    applyTeamActions([{ type: 'create_agent', id: 'mcp1', systemPrompt: 'x', mcpAllowlist: ['qmt-readonly', 'bogus-mcp'] }], 'ws5')
    expect(getAgent('ws5', 'mcp1')?.mcpAllowlist).toEqual(['qmt-readonly'])
  })

  it('delete → 不直接删,回 pending;队长不可删', () => {
    applyTeamActions([{ type: 'create_agent', id: 'd1', systemPrompt: 'x' }], 'ws4')
    const r = applyTeamActions([{ type: 'delete_agent', id: 'd1' }, { type: 'delete_agent', id: 'team.leader' }], 'ws4')
    expect(r.pendingDeletes).toEqual(['d1'])
    expect(getAgent('ws4', 'd1')).toBeTruthy() // 等 UI 二次确认,未真删
    expect(r.applied).toContain('队长不可删')
  })
})

describe('parseTeamAssistantResult —— 丢弃非法动作', () => {
  it('无 id / 非法 type 被丢', () => {
    const r = parseTeamAssistantResult({
      reply: 'ok',
      actions: [{ type: 'create_agent', id: 'a' }, { type: 'create_agent' }, { type: 'bogus', id: 'x' }],
    })
    expect(r.actions).toHaveLength(1)
    expect(r.actions[0].id).toBe('a')
  })

  it('口语模型名映射成真实 id', () => {
    const r = parseTeamAssistantResult({ reply: '', actions: [{ type: 'create_agent', id: 'a', model: 'opus' }] })
    expect((r.actions[0] as { model?: string }).model).toBe('claude-opus-4-8')
  })
})
