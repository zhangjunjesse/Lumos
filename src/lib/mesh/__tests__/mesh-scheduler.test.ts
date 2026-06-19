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
  computeNextRunAt,
  tickLoop,
  dispatchDutyCycle,
  MAX_CONCURRENT,
  type SchedulerRunner,
  type DueItem,
} from '../mesh-scheduler'
import { runOneDutyCycle } from '../mesh-duty-cycle'
import { buildParticipant } from '../mesh-session-context'
import { initParticipants, getParticipant } from '../mesh-participant-store'
import { persistMessage } from '../mesh-event-bus'

const mockedRun = jest.mocked(runOneDutyCycle)
const mockedBuildP = jest.mocked(buildParticipant)

function runner(runId: string, abort = new AbortController(), inFlight = new Set<string>()): SchedulerRunner {
  return { runId, accountId: 'a', tickMs: 2500, abort, snapshot: () => ({}), inFlight, ticker: null, stopped: false }
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

  it('computeNextRunAt：空转指数退避，封顶 5 档', () => {
    expect(computeNextRunAt(60000, 0, 1000)).toBe(1000 + 60000)
    expect(computeNextRunAt(60000, 2, 1000)).toBe(1000 + 60000 * 4)
    expect(computeNextRunAt(60000, 99, 0)).toBe(60000 * 2 ** 5) // 封顶
  })

  it('dispatchDutyCycle：active_loop 空转跑完 → 写 next_run_at + idleStreak+1 + 清 inFlight', async () => {
    initParticipants('rs4', [{ participantId: 'stock.observe', role: 'observe', subscriptions: [], workMode: 'active_loop' }], 100)
    mockedBuildP.mockReturnValue(PART)
    mockedRun.mockResolvedValue({ thought: '', writes: ['无新异动'], emits: [], orders: [] }) // 空转（无 emit/order）
    const r = runner('rs4', new AbortController(), new Set(['stock.observe']))
    await dispatchDutyCycle(r, { participantId: 'stock.observe', trigger: 'timer', delivery: null })
    const p = getParticipant('rs4', 'stock.observe')!
    expect(p.nextRunAt).toBeGreaterThan(100) // 排了下次
    expect(p.idleStreak).toBe(1) // 空转退避计数
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
})
