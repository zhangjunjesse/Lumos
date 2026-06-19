/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

import {
  initParticipants,
  queryDueParticipants,
  getParticipant,
  listParticipants,
  updateParticipant,
  nextCycleSeq,
  deleteByRun,
} from '../mesh-participant-store'

describe('mesh-participant-store —— 每 agent 运行态（§430）', () => {
  it('initParticipants：active_loop next_run_at=now，event_driven 不主动跑(null)', () => {
    initParticipants(
      'r1',
      [
        { participantId: 'stock.observe', role: 'observe', subscriptions: [], workMode: 'active_loop' },
        { participantId: 'stock.risk', role: 'risk', subscriptions: ['agent_task'], workMode: 'event_driven' },
      ],
      1000,
    )
    const obs = getParticipant('r1', 'stock.observe')!
    const risk = getParticipant('r1', 'stock.risk')!
    expect(obs.nextRunAt).toBe(1000)
    expect(obs.workMode).toBe('active_loop')
    expect(obs.cycleSeq).toBe(0)
    expect(risk.nextRunAt).toBeNull()
    expect(risk.subscriptions).toEqual(['agent_task'])
  })

  it('queryDueParticipants：只选 active_loop + 到点，跳过 paused / 未到点 / event_driven', () => {
    initParticipants(
      'r2',
      [
        { participantId: 'a', role: 'observe', subscriptions: [], workMode: 'active_loop' },
        { participantId: 'b', role: 'review', subscriptions: [], workMode: 'active_loop' },
        { participantId: 'c', role: 'risk', subscriptions: [], workMode: 'event_driven' },
      ],
      500,
    )
    updateParticipant('r2', 'b', { nextRunAt: 9999 }) // 推到未来
    expect(queryDueParticipants('r2', 1000).map((d) => d.participantId)).toEqual(['a']) // b 未到点、c event_driven
    updateParticipant('r2', 'a', { status: 'paused' })
    expect(queryDueParticipants('r2', 1000)).toHaveLength(0)
  })

  it('updateParticipant：局部更新 state/idleStreak/nextRunAt/lastRunAt', () => {
    initParticipants('r3', [{ participantId: 'a', role: 'observe', subscriptions: [], workMode: 'active_loop' }], 0)
    updateParticipant('r3', 'a', { state: { lastHash: 'abc' }, idleStreak: 3, nextRunAt: 7000, lastRunAt: 6000 })
    const p = getParticipant('r3', 'a')!
    expect(p.state).toEqual({ lastHash: 'abc' })
    expect(p.idleStreak).toBe(3)
    expect(p.nextRunAt).toBe(7000)
    expect(p.lastRunAt).toBe(6000)
  })

  it('nextCycleSeq：单调自增且持久（下单幂等键用，防重启撞 key）', () => {
    initParticipants('r4', [{ participantId: 'a', role: 'risk', subscriptions: [], workMode: 'event_driven' }], 0)
    expect(nextCycleSeq('r4', 'a')).toBe(1)
    expect(nextCycleSeq('r4', 'a')).toBe(2)
    expect(nextCycleSeq('r4', 'a')).toBe(3)
    expect(getParticipant('r4', 'a')!.cycleSeq).toBe(3) // 持久
  })

  it('deleteByRun：清该 session 全部行', () => {
    initParticipants(
      'r5',
      [
        { participantId: 'a', role: 'observe', subscriptions: [], workMode: 'active_loop' },
        { participantId: 'b', role: 'risk', subscriptions: [], workMode: 'event_driven' },
      ],
      0,
    )
    expect(listParticipants('r5')).toHaveLength(2)
    expect(deleteByRun('r5')).toBe(2)
    expect(listParticipants('r5')).toHaveLength(0)
  })

  it('initParticipants 幂等：重复 init 同 run 不覆盖已有运行态', () => {
    initParticipants('r6', [{ participantId: 'a', role: 'observe', subscriptions: ['quote_anomaly'], workMode: 'active_loop' }], 100)
    updateParticipant('r6', 'a', { nextRunAt: 5000 })
    initParticipants('r6', [{ participantId: 'a', role: 'observe', subscriptions: [], workMode: 'active_loop' }], 200) // INSERT OR IGNORE
    const p = getParticipant('r6', 'a')!
    expect(p.nextRunAt).toBe(5000) // 原行保留
    expect(p.subscriptions).toEqual(['quote_anomaly'])
  })
})
