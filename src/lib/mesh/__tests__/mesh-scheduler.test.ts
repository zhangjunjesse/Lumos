/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})
jest.mock('../mesh-duty-cycle', () => ({ runOneDutyCycle: jest.fn() }))
jest.mock('../mesh-session-context', () => ({
  buildParticipant: jest.fn(),
  buildSubscribersOf: jest.fn(() => () => []),
  buildTradeContext: jest.fn(() => ({ mode: 'auto', accountId: 'a', tradeMode: 'paper', liveEnabled: false })),
  getSessionFocus: jest.fn(() => ''),
  getAgentIntervalMs: jest.fn(() => 60000),
}))

import {
  selectDue,
  pickDispatchable,
  tickLoop,
  dispatchDutyCycle,
  emitMarketClose,
  MAX_CONCURRENT,
  type SchedulerRunner,
  type DueItem,
} from '../mesh-scheduler'
import { runOneDutyCycle } from '../mesh-duty-cycle'
import { buildParticipant, buildSubscribersOf } from '../mesh-session-context'
import { initParticipants, getParticipant } from '../mesh-participant-store'
import { persistMessage, listPendingDeliveries } from '../mesh-event-bus'

const mockedRun = jest.mocked(runOneDutyCycle)
const mockedBuildP = jest.mocked(buildParticipant)
const mockedSubs = jest.mocked(buildSubscribersOf)

function runner(runId: string, abort = new AbortController(), inFlight = new Set<string>()): SchedulerRunner {
  return { runId, accountId: 'a', tickMs: 2500, abort, snapshot: () => ({}), inFlight, inFlightTasks: new Map(), ticker: null, stopped: false }
}
const PART = { agent: { id: 'stock.observe', role: 'observe' as const, systemPrompt: '', mcpAllowlist: [], toolAllowlist: [] }, topics: [] }

beforeEach(() => {
  mockedRun.mockReset()
  mockedBuildP.mockReset()
})

describe('mesh-scheduler —— 时间轮调度（S4）', () => {
  it('selectDue：事件/任务优先于主动 timer', () => {
    initParticipants(
      'rs1',
      [
        { participantId: 'stock.observe', role: 'observe', subscriptions: [], workMode: 'active_loop' },
        { participantId: 'stock.decide', role: 'decide', subscriptions: ['quote_anomaly'], workMode: 'event_driven' },
      ],
      100,
    )
    persistMessage('rs1', 'quote_anomaly', { code: 'x' }, 'stock.observe', ['stock.decide'])
    const due = selectDue('rs1', 1000)
    expect(due[0]).toMatchObject({ participantId: 'stock.decide', trigger: 'event' }) // 事件在前
    expect(due.find((d) => d.participantId === 'stock.observe')?.trigger).toBe('timer') // 定时在后
  })

  it('pickDispatchable：并发上限 + inFlight 跳过 + 单 tick 上限', () => {
    const due: DueItem[] = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ participantId: id, trigger: 'timer', delivery: null }))
    expect(pickDispatchable(due, new Set())).toHaveLength(MAX_CONCURRENT) // 3，余下留下个 tick
    expect(pickDispatchable([{ participantId: 'a', trigger: 'timer', delivery: null }, { participantId: 'b', trigger: 'timer', delivery: null }], new Set(['a'])).map((p) => p.participantId)).toEqual(['b']) // a 在飞跳过
  })

  it('dispatchDutyCycle：active_loop 跑完按固定间隔排下次（框架不退避，idleStreak 不变）+ 清 inFlight', async () => {
    initParticipants('rs4', [{ participantId: 'stock.observe', role: 'observe', subscriptions: [], workMode: 'active_loop' }], 100)
    mockedBuildP.mockReturnValue(PART)
    mockedRun.mockResolvedValue({ thought: '', writes: ['无新异动'], emits: [], orders: [] }) // 无 emit/order：框架不再据此退避
    const r = runner('rs4', new AbortController(), new Set(['stock.observe']))
    const before = Date.now()
    await dispatchDutyCycle(r, { participantId: 'stock.observe', trigger: 'timer', delivery: null })
    const p = getParticipant('rs4', 'stock.observe')!
    expect(p.nextRunAt).toBeGreaterThanOrEqual(before + 60000) // 固定间隔(mock interval=60s)，无指数退避
    expect(p.nextRunAt).toBeLessThan(before + 120000)
    expect(p.idleStreak).toBe(0) // 框架不再退避，idleStreak 不被累加
    expect(r.inFlight.has('stock.observe')).toBe(false)
  })

  it('dispatchDutyCycle：abort 后不 scheduleNext（不写 next_run_at）', async () => {
    initParticipants('rs5', [{ participantId: 'stock.observe', role: 'observe', subscriptions: [], workMode: 'active_loop' }], 100)
    mockedBuildP.mockReturnValue(PART)
    const abort = new AbortController()
    mockedRun.mockImplementation(async () => {
      abort.abort() // duty cycle 跑到一半被 stop
      return { thought: '', writes: [], emits: [], orders: [] }
    })
    const r = runner('rs5', abort, new Set(['stock.observe']))
    await dispatchDutyCycle(r, { participantId: 'stock.observe', trigger: 'timer', delivery: null })
    expect(getParticipant('rs5', 'stock.observe')!.nextRunAt).toBe(100) // 未被改写
    expect(r.inFlight.has('stock.observe')).toBe(false) // 仍清理 inFlight
  })

  it('tickLoop：abort 时直接 return，不派发、不排 ticker', () => {
    const abort = new AbortController()
    abort.abort()
    const r = runner('rs6', abort)
    tickLoop(r)
    expect(r.ticker).toBeNull()
    expect(mockedRun).not.toHaveBeenCalled()
  })

  it('emitMarketClose：投递给订阅 market_close 的 agent（复盘 W7）', () => {
    mockedSubs.mockReturnValue((t: string) => (t === 'market_close' ? ['stock.review'] : []))
    emitMarketClose(runner('rs_close'))
    const pending = listPendingDeliveries('rs_close')
    expect(pending.find((p) => p.subscriberId === 'stock.review' && p.topic === 'market_close')).toBeTruthy()
  })
})
