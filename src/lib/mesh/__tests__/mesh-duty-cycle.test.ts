/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})
jest.mock('../mesh-worker', () => ({ runMeshActor: jest.fn() }))
jest.mock('../mesh-order-gateway', () => ({ placeOrder: jest.fn() }))

import { runOneDutyCycle } from '../mesh-duty-cycle'
import { runMeshActor } from '../mesh-worker'
import { placeOrder } from '../mesh-order-gateway'
import { persistMessage, listPendingDeliveries } from '../mesh-event-bus'
import { readBlackboard } from '../mesh-blackboard'
import type { MeshParticipant, TradeContext } from '../mesh-runtime'

const mockedActor = jest.mocked(runMeshActor)
const mockedPlace = jest.mocked(placeOrder)
const tradeCtx: TradeContext = { mode: 'auto', accountId: 'acc', tradeMode: 'paper', liveEnabled: false }

function participant(id: string, role: MeshParticipant['agent']['role']): MeshParticipant {
  return { agent: { id, role, systemPrompt: '', mcpAllowlist: [], toolAllowlist: [] }, topics: [] }
}

beforeEach(() => {
  mockedActor.mockReset()
  mockedPlace.mockReset()
})

describe('mesh-duty-cycle —— runOneDutyCycle 执行核（S2）', () => {
  it('event 触发（agent_task）：跑 plan、写白板、消费 consumed 投递，prompt 含任务', async () => {
    const mid = persistMessage('run-d1', 'agent_task', { summary: '审买入 X', from: 'stock.decide' }, 'stock.decide', ['stock.risk'], 'task-1')
    mockedActor.mockResolvedValue({
      plan: { thought: '审议', actions: [{ type: 'write_blackboard', key: 'risk_review', value: { ok: true } }] },
      text: '',
    })

    const r = await runOneDutyCycle({
      runId: 'run-d1',
      participant: participant('stock.risk', 'risk'),
      trigger: 'event',
      delivery: { messageId: mid, subscriberId: 'stock.risk', topic: 'agent_task', payload: { summary: '审买入 X', from: 'stock.decide' }, taskId: 'task-1' },
      cycleSeq: 1,
      subscribersOf: () => [],
      tradeCtx,
    })

    expect(r.writes).toContain('risk_review')
    expect(readBlackboard('run-d1', 'risk_review')?.value).toEqual({ ok: true })
    // consumed 投递被 markDelivered → 风控不再有 pending
    expect(listPendingDeliveries('run-d1').find((p) => p.subscriberId === 'stock.risk')).toBeUndefined()
    // 风控收到的是定向任务 prompt
    const prompt = mockedActor.mock.calls[0][1]
    expect(prompt).toContain('定向任务')
    expect(prompt).toContain('task-1')
  })

  it('event 触发 emit_event：投递给订阅者', async () => {
    mockedActor.mockResolvedValue({
      plan: { thought: '发现异动', actions: [{ type: 'emit_event', topic: 'quote_anomaly', payload: { code: '600160' } }] },
      text: '',
    })
    const r = await runOneDutyCycle({
      runId: 'run-d2',
      participant: participant('stock.observe', 'observe'),
      trigger: 'event',
      delivery: { messageId: persistMessage('run-d2', 'tick', {}, 'seed', ['stock.observe']), subscriberId: 'stock.observe', topic: 'tick', payload: {} },
      cycleSeq: 1,
      subscribersOf: (t) => (t === 'quote_anomaly' ? ['stock.decide'] : []),
      tradeCtx,
    })
    expect(r.emits).toContain('quote_anomaly')
    expect(listPendingDeliveries('run-d2').find((p) => p.subscriberId === 'stock.decide')).toBeTruthy()
  })

  it('timer 触发（盯盘 active_loop）：用主动盯盘 prompt（含 snapshot），无 consumed', async () => {
    mockedActor.mockResolvedValue({ plan: { thought: '看盘', actions: [] }, text: '' })
    const r = await runOneDutyCycle({
      runId: 'run-d3',
      participant: participant('stock.observe', 'observe'),
      trigger: 'timer',
      cycleSeq: 1,
      subscribersOf: () => [],
      tradeCtx,
      snapshot: { ticks: [{ code: '600160', pct: 9 }] },
    })
    const prompt = mockedActor.mock.calls[0][1]
    expect(prompt).toContain('盯盘')
    expect(prompt).toContain('600160')
    expect(r.writes).toHaveLength(0)
  })

  it('cycleSeq 进下单幂等键：同 runId/agent 不同 cycle → 不同 key（常驻不撞、新单不被吞）', async () => {
    mockedPlace.mockResolvedValue({ ticketId: 't', status: 'filled', filled: true, reason: '', price: 45 })
    mockedActor.mockResolvedValue({
      plan: { thought: '批准', actions: [{ type: 'order_intent', symbol: '600160', side: 'buy', qty: 100 }] },
      text: '',
    })
    const ctx: TradeContext = { mode: 'auto', accountId: 'acc-s3', tradeMode: 'paper', liveEnabled: false }
    const base = { runId: 'run-s3', participant: participant('stock.risk', 'risk'), trigger: 'timer' as const, subscribersOf: () => [], tradeCtx: ctx }
    await runOneDutyCycle({ ...base, cycleSeq: 1 })
    await runOneDutyCycle({ ...base, cycleSeq: 2 })
    const keys = mockedPlace.mock.calls.map((c) => c[2].idempotencyKey)
    expect(keys[0]).toBe('run-s3:stock.risk:1:0')
    expect(keys[1]).toBe('run-s3:stock.risk:2:0')
    expect(keys[0]).not.toBe(keys[1]) // 常驻 runId 跨 cycle 不撞 key
  })
})
