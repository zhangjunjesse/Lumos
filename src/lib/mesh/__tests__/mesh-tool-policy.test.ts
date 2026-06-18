// mcp-resolver 拉了 DB 等重依赖；本测试只验证裁决逻辑，mock 掉它的纯转换函数即可。
jest.mock('@/lib/mcp-resolver', () => ({
  toSdkMcpConfig: jest.fn((servers: Record<string, unknown>) => servers),
}))

import {
  parseMcpServerName,
  isToolAllowed,
  createMeshCanUseTool,
} from '../mesh-tool-policy'
import type { MeshAgentConfig } from '../mesh-agent-config'

const agent: MeshAgentConfig = {
  id: 'observe.market',
  role: 'observe',
  systemPrompt: 'observe',
  mcpAllowlist: ['qmt-readonly'],
  toolAllowlist: ['Read', 'Grep'],
}

const toolCtx = { signal: new AbortController().signal, toolUseID: 't1' }

describe('parseMcpServerName', () => {
  it('extracts the server from an mcp tool name', () => {
    expect(parseMcpServerName('mcp__qmt-readonly__qmt_get_tick')).toBe('qmt-readonly')
  })
  it('returns null for a non-mcp tool', () => {
    expect(parseMcpServerName('Read')).toBeNull()
  })
})

describe('isToolAllowed', () => {
  it('allows a builtin tool in the allowlist', () => {
    expect(isToolAllowed(agent, 'Read')).toBe(true)
  })
  it('denies a builtin tool not in the allowlist', () => {
    expect(isToolAllowed(agent, 'Bash')).toBe(false)
  })
  it('allows an mcp tool whose server is whitelisted', () => {
    expect(isToolAllowed(agent, 'mcp__qmt-readonly__qmt_query_positions')).toBe(true)
  })
  it('denies an mcp tool whose server is NOT whitelisted (e.g. order/trade)', () => {
    expect(isToolAllowed(agent, 'mcp__qmt-trade__place_order')).toBe(false)
  })
})

describe('createMeshCanUseTool', () => {
  const canUse = createMeshCanUseTool(agent)

  it('allows a whitelisted tool and passes input through', async () => {
    const res = await canUse('Read', { file_path: '/x' }, toolCtx as never)
    expect(res.behavior).toBe('allow')
  })

  it('denies an order tool with an explanatory message', async () => {
    const res = await canUse('mcp__qmt-trade__place_order', { code: '600160.SH' }, toolCtx as never)
    expect(res.behavior).toBe('deny')
    if (res.behavior === 'deny') {
      expect(res.message).toContain('not in allowlist')
    }
  })

  it('denies an unknown tool', async () => {
    const res = await canUse('SomeRandomTool', {}, toolCtx as never)
    expect(res.behavior).toBe('deny')
  })
})
