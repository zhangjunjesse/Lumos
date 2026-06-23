jest.mock('@/lib/mcp-resolver', () => ({
  toSdkMcpConfig: jest.fn((servers: Record<string, unknown>) => servers),
}))

import { STOCK_WATCH_AGENT, getMeshAgent } from '../mesh-stock-agents'
import { createMeshCanUseTool } from '../mesh-tool-policy'

const toolCtx = { signal: new AbortController().signal, toolUseID: 't' }

describe('STOCK_WATCH_AGENT (read-only watcher)', () => {
  it('can see the market via qmt-readonly', () => {
    expect(STOCK_WATCH_AGENT.mcpAllowlist).toContain('qmt-readonly')
  })

  it('config 不额外声明内置工具白名单（内置由「全放开」策略提供）', () => {
    expect(STOCK_WATCH_AGENT.toolAllowlist).toEqual([])
  })

  it('下单/未注入 MCP 工具仍被拒（下单靠 OrderGateway 结构隔离，从不注册下单 server）', async () => {
    const canUse = createMeshCanUseTool(STOCK_WATCH_AGENT)
    for (const tool of ['mcp__qmt-trade__place_order', 'mcp__qmt-trade__cancel_order']) {
      const verdict = await canUse(tool, {}, toolCtx as never)
      expect(verdict.behavior).toBe('deny')
    }
  })

  it('内置工具全放开：Bash / Write / Read 现在都放行', async () => {
    const canUse = createMeshCanUseTool(STOCK_WATCH_AGENT)
    for (const tool of ['Bash', 'Write', 'Read']) {
      const verdict = await canUse(tool, {}, toolCtx as never)
      expect(verdict.behavior).toBe('allow')
    }
  })

  it('allows the read-only qmt tools it needs', async () => {
    const canUse = createMeshCanUseTool(STOCK_WATCH_AGENT)
    const verdict = await canUse('mcp__qmt-readonly__qmt_get_tick', {}, toolCtx as never)
    expect(verdict.behavior).toBe('allow')
  })

  it('lookup by id works', () => {
    expect(getMeshAgent('stock.observe')).toBe(STOCK_WATCH_AGENT)
    expect(getMeshAgent('nope')).toBeUndefined()
  })
})
