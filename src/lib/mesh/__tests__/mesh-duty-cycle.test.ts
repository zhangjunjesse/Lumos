/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})
jest.mock('../mesh-worker', () => ({ runMeshAgentText: jest.fn() }))
// duty-cycle 现在(为门控下单)import 了 mesh-trade-mcp-server,它会加载 SDK ESM → 在 jest 里需 stub。
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (cfg: unknown) => cfg,
  tool: (name: string, _desc: string, _schema: unknown, handler: unknown) => ({ name, handler }),
}))

import { runOneDutyCycle } from '../mesh-duty-cycle'
import { runMeshAgentText } from '../mesh-worker'
import { persistMessage, listPendingDeliveries } from '../mesh-event-bus'
import { getMcpStatus } from '../mesh-mcp-status'
import type { MeshParticipant, TradeContext } from '../mesh-runtime'

const mockedText = jest.mocked(runMeshAgentText)
const tradeCtx: TradeContext = { mode: 'auto', accountId: 'acc', tradeMode: 'paper', liveEnabled: false }

function participant(id: string, role: MeshParticipant['agent']['role'], mcpAllowlist: string[] = []): MeshParticipant {
  return { agent: { id, role, systemPrompt: '', mcpAllowlist, toolAllowlist: [] }, topics: [] }
}

beforeEach(() => {
  mockedText.mockReset()
  mockedText.mockResolvedValue({ text: 'done' })
})

describe('mesh-duty-cycle —— runOneDutyCycle 执行核（工具注入 + 投递消费）', () => {
  it('注入协作上下文：runId/agentId/subscribersOf 传给 worker（人人可用）', async () => {
    const subscribersOf = (t: string) => (t === 'x' ? ['a', 'b'] : [])
    await runOneDutyCycle({
      runId: 'run-c', workshopId: 'ws', participant: participant('observe.1', 'observe'),
      trigger: 'timer', cycleSeq: 1, subscribersOf, tradeCtx,
    })
    const opts = mockedText.mock.calls[0][2]!
    expect(opts.collabContext).toMatchObject({ runId: 'run-c', agentId: 'observe.1' })
    expect(opts.collabContext!.subscribersOf('x')).toEqual(['a', 'b'])
  })

  it('下单上下文按白名单门控：含 mesh-trade 才注入（带 cycleSeq + 当前 trade）', async () => {
    await runOneDutyCycle({
      runId: 'run-t', workshopId: 'ws', participant: participant('risk.1', 'custom', ['mesh-trade']),
      trigger: 'timer', cycleSeq: 9, subscribersOf: () => [], tradeCtx,
    })
    expect(mockedText.mock.calls[0][2]!.tradeContext).toEqual({ runId: 'run-t', agentId: 'risk.1', cycleSeq: 9, trade: tradeCtx })
  })

  it('无 mesh-trade 白名单 → 不给下单上下文（能力隔离：够不到 place_order）', async () => {
    await runOneDutyCycle({
      runId: 'run-n', workshopId: 'ws', participant: participant('observe.1', 'observe'),
      trigger: 'timer', cycleSeq: 1, subscribersOf: () => [], tradeCtx,
    })
    expect(mockedText.mock.calls[0][2]!.tradeContext).toBeUndefined()
  })

  it('event 触发（agent_task）：prompt 含任务内容，turn 后消费该投递', async () => {
    const mid = persistMessage('run-d1', 'agent_task', { summary: '审买入 X', from: 'decide' }, 'decide', ['risk'], 'task-1')
    await runOneDutyCycle({
      runId: 'run-d1', workshopId: 'ws', participant: participant('risk', 'custom'),
      trigger: 'event',
      delivery: { messageId: mid, subscriberId: 'risk', topic: 'agent_task', payload: { summary: '审买入 X', from: 'decide' }, taskId: 'task-1' },
      cycleSeq: 1, subscribersOf: () => [], tradeCtx,
    })
    const prompt = mockedText.mock.calls[0][1]
    expect(prompt).toContain('定向任务')
    expect(prompt).toContain('task-1')
    expect(listPendingDeliveries('run-d1').find((p) => p.subscriberId === 'risk')).toBeUndefined() // 已消费
  })

  it('timer 主动 active_loop：通用主动 prompt（不按角色分叉、不喂业务数据），无投递可消费', async () => {
    await runOneDutyCycle({
      runId: 'run-d3', workshopId: 'ws', participant: participant('observe', 'observe'),
      trigger: 'timer', cycleSeq: 1, subscribersOf: () => [], tradeCtx,
    })
    const prompt = mockedText.mock.calls[0][1]
    expect(prompt).toContain('主动履职')
    expect(prompt).toContain('共享黑板') // 通用 prompt 只喂黑板,不喂行情快照/角色分叉
  })

  it('记忆：prompt 前置该 agent 最近对话（无状态 agent 跨 cycle 记住用户纠正）', async () => {
    persistMessage('run-mem', 'agent_task', { summary: '时分秒别给0', from: '用户' }, 'user', ['my.custom'], 'ut-1')
    await runOneDutyCycle({
      runId: 'run-mem', workshopId: 'ws', participant: participant('my.custom', 'custom'),
      trigger: 'timer', cycleSeq: 1, subscribersOf: () => [], tradeCtx,
    })
    const prompt = mockedText.mock.calls[0][1]
    expect(prompt).toContain('最近的对话')
    expect(prompt).toContain('时分秒别给0')
  })

  it('MCP 状态落库：worker 返回 mcpStatus → 落库 → 可读回（黑盒失败可见）', async () => {
    mockedText.mockResolvedValue({ text: 'ok', mcpStatus: [{ name: 'qmt-readonly', status: 'connected' }] })
    await runOneDutyCycle({
      runId: 'run-mcp', workshopId: 'ws-mcp', participant: participant('observe', 'observe'),
      trigger: 'timer', cycleSeq: 1, subscribersOf: () => [], tradeCtx,
    })
    expect(getMcpStatus('ws-mcp', 'observe')).toEqual([{ name: 'qmt-readonly', status: 'connected' }])
  })

  it('abort：中止后返回思考，但不消费投递、不落 MCP 状态', async () => {
    const ac = new AbortController()
    mockedText.mockImplementation(async () => {
      ac.abort()
      return { text: '半截', mcpStatus: [{ name: 'qmt-readonly', status: 'connected' }] }
    })
    const mid = persistMessage('run-ab', 'tick', {}, 'seed', ['observe'])
    const r = await runOneDutyCycle({
      runId: 'run-ab', workshopId: 'ws-ab', participant: participant('observe', 'observe'),
      trigger: 'event', delivery: { messageId: mid, subscriberId: 'observe', topic: 'tick', payload: {} },
      cycleSeq: 1, subscribersOf: () => [], tradeCtx, abortController: ac,
    })
    expect(r.thought).toBe('半截')
    expect(listPendingDeliveries('run-ab').find((p) => p.subscriberId === 'observe')).toBeTruthy() // 未消费
    expect(getMcpStatus('ws-ab', 'observe')).toEqual([]) // 未落库
  })
})
