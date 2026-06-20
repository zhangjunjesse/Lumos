const mockQuery = jest.fn()

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
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

import { runMeshAgent } from '../mesh-worker'
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
})
