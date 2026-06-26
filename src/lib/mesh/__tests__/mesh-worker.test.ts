const mockQuery = jest.fn()

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  // 框架级协作/下单工具是 in-process MCP（createSdkMcpServer 构建）：stub 成直通即可,工具不真跑。
  createSdkMcpServer: (cfg: unknown) => cfg,
  tool: (name: string, _desc: string, _schema: unknown, handler: unknown) => ({ name, handler }),
}))

jest.mock('@/lib/claude/sdk-runtime', () => ({
  buildClaudeSdkInvocationContext: jest.fn(() => ({
    env: { ANTHROPIC_AUTH_TOKEN: 'runtime-secret' },
    settingSources: ['project'],
    pathToClaudeCodeExecutable: '/tmp/claude-agent-sdk/cli.js',
    resolvedModel: 'claude-haiku-4-5',
  })),
}))

// 纯转换 stub：原样把白名单 server 映射成最简 stdio 配置。
jest.mock('@/lib/mcp-resolver', () => ({
  toSdkMcpConfig: jest.fn((servers: Record<string, unknown>) => {
    const out: Record<string, unknown> = {}
    for (const name of Object.keys(servers)) {
      out[name] = { command: 'python', args: ['qmt_mcp_server.py'] }
    }
    return out
  }),
}))

import { runMeshAgent, runMeshAgentText } from '../mesh-worker'
import type { MeshAgentConfig } from '../mesh-agent-config'

async function* streamMessages(messages: unknown[]) {
  for (const message of messages) {
    yield message
  }
}

const agent: MeshAgentConfig = {
  id: 'observe.market',
  role: 'observe',
  systemPrompt: 'observe',
  mcpAllowlist: ['qmt-readonly'],
  toolAllowlist: ['Read'],
}

describe('runMeshAgent', () => {
  beforeEach(() => {
    mockQuery.mockReset()
  })

  it('assembles safe query options: non-bypass, real canUseTool, whitelisted MCP only', async () => {
    mockQuery.mockReturnValue(streamMessages([{ type: 'result', result: 'done' }]))

    await runMeshAgent(agent, 'hello')

    const queryArg = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> }
    const options = queryArg.options
    expect(options.permissionMode).toBe('default')
    expect(options.permissionMode).not.toBe('bypassPermissions')
    expect(typeof options.canUseTool).toBe('function')
    expect(Object.keys(options.mcpServers as object)).toEqual(['qmt-readonly'])
  })

  it('the assembled canUseTool denies a non-whitelisted (order) tool', async () => {
    mockQuery.mockReturnValue(streamMessages([{ type: 'result', result: 'done' }]))

    await runMeshAgent(agent, 'hi')

    const queryArg = mockQuery.mock.calls[0][0] as {
      options: { canUseTool: (n: string, i: object, c: object) => Promise<{ behavior: string }> }
    }
    const verdict = await queryArg.options.canUseTool(
      'mcp__qmt-trade__place_order',
      {},
      { signal: new AbortController().signal, toolUseID: 't' },
    )
    expect(verdict.behavior).toBe('deny')
  })

  it('collects text/result from the stream and completes', async () => {
    mockQuery.mockReturnValue(
      streamMessages([
        { type: 'assistant', text: 'looking... ' },
        { type: 'result', result: 'no opportunity' },
      ]),
    )

    const res = await runMeshAgent(agent, 'scan')

    expect(res.finishReason).toBe('completed')
    expect(res.text).toContain('no opportunity')
  })

  it('外部 abort 监听器跑完即解绑（常驻长会话不在会话级 signal 上累积泄漏）', async () => {
    mockQuery.mockReturnValue(streamMessages([{ type: 'result', result: 'done' }]))
    const external = new AbortController()
    const removeSpy = jest.spyOn(external.signal, 'removeEventListener')
    await runMeshAgent(agent, 'hi', { abortController: external })
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function)) // finally 里解绑了本轮注册的监听器
  })
})

describe('runMeshAgentText —— 框架级工具注入（协作人人可用 + 下单按白名单门控）', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockQuery.mockReturnValue(streamMessages([{ type: 'result', result: 'done' }]))
  })
  const optionsOf = () => (mockQuery.mock.calls[0][0] as { options: Record<string, unknown> }).options
  const trade = { runId: 'r', agentId: 'a', cycleSeq: 1, trade: { mode: 'auto' as const, accountId: 'acc', tradeMode: 'paper' as const, liveEnabled: false } }

  it('有 collabContext → 注入 mesh-collab + allowedTools 含 5 个协作工具（人人可用）', async () => {
    await runMeshAgentText(agent, 'p', { collabContext: { runId: 'r', agentId: 'a', subscribersOf: () => [] } })
    const options = optionsOf()
    expect(Object.keys(options.mcpServers as object)).toContain('mesh-collab')
    const allowed = options.allowedTools as string[]
    for (const t of ['read_blackboard', 'write_blackboard', 'emit_event', 'send_task', 'reply']) {
      expect(allowed).toContain(`mcp__mesh-collab__${t}`)
    }
  })

  it('有 tradeContext 且白名单含 mesh-trade → 注入 mesh-trade + place_order', async () => {
    const trader: MeshAgentConfig = { ...agent, mcpAllowlist: ['mesh-trade'] }
    await runMeshAgentText(trader, 'p', { tradeContext: trade })
    const options = optionsOf()
    expect(Object.keys(options.mcpServers as object)).toContain('mesh-trade')
    expect(options.allowedTools as string[]).toContain('mcp__mesh-trade__place_order')
  })

  it('有 tradeContext 但白名单无 mesh-trade → 不注入下单工具（能力隔离）', async () => {
    await runMeshAgentText(agent, 'p', { tradeContext: trade })
    const options = optionsOf()
    const servers = options.mcpServers ? Object.keys(options.mcpServers as object) : []
    expect(servers).not.toContain('mesh-trade')
    expect(options.allowedTools as string[]).not.toContain('mcp__mesh-trade__place_order')
  })
})
