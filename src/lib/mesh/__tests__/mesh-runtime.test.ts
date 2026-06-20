/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

jest.mock('../mesh-worker', () => ({ runMeshActor: jest.fn() }))

import { runMeshActor } from '../mesh-worker'
import { runCollaborationOnce, type MeshParticipant } from '../mesh-runtime'
import { listPendingDeliveries } from '../mesh-event-bus'
import { readBlackboard } from '../mesh-blackboard'
import { DEFAULT_RISK_RULES } from '../mesh-risk-rules'

const mockedActor = jest.mocked(runMeshActor)

function setActors(opts: { riskApproves: boolean }) {
  mockedActor.mockImplementation(async (agent: { id: string }) => {
    if (agent.id === 'observe') {
      return {
        plan: {
          thought: '放量拉升',
          actions: [
            { type: 'write_blackboard', key: 'obs', value: { code: '600160.SH' } },
            { type: 'emit_event', topic: 'quote_anomaly', payload: { code: '600160.SH', reason: '拉升' } },
          ],
        },
        text: '',
      }
    }
    if (agent.id === 'decide') {
      return {
        plan: {
          thought: '提议买',
          actions: [
            { type: 'write_blackboard', key: 'decision', value: { action: 'buy', reason: '低吸' } },
            { type: 'emit_event', topic: 'order_proposal', payload: { symbol: '600160.SH', side: 'buy', qty: 100, reason: '低吸' } },
          ],
        },
        text: '',
      }
    }
    if (agent.id === 'risk') {
      return opts.riskApproves
        ? { plan: { thought: 'approve', actions: [{ type: 'order_intent', symbol: '600160.SH', side: 'buy', qty: 100 }] }, text: '' }
        : { plan: { thought: 'reject', actions: [{ type: 'write_blackboard', key: 'risk_review', value: { approved: false, reason: '追高' } }] }, text: '' }
    }
    if (agent.id === 'review') {
      return { plan: { thought: '复盘', actions: [{ type: 'write_blackboard', key: 'review', value: { summary: '本轮一笔' } }] }, text: '' }
    }
    return { plan: { thought: '', actions: [] }, text: '' }
  })
}

function P(id: string, role: string, topics: string[]): MeshParticipant {
  return { agent: { id, role: role as MeshParticipant['agent']['role'], systemPrompt: '', mcpAllowlist: [], toolAllowlist: [] }, topics }
}
const participants = [P('observe', 'observe', []), P('decide', 'decide', ['quote_anomaly']), P('risk', 'risk', ['order_proposal']), P('review', 'review', [])]
const snapshot = { ticks: [{ code: '600160.SH', last: 45, pct: 5 }] }
const seed = { snapshotKey: 'market_snapshot', snapshot, starterId: 'observe', reviewerId: 'review' }

describe('runCollaborationOnce — M4 风控审议 + 复盘', () => {
  it('approve 链：盯盘→决策提议→风控批准→成交→复盘', async () => {
    setActors({ riskApproves: true })
    const r = await runCollaborationOnce(participants, seed)
    expect(r.trace.map((t) => t.participantId)).toEqual(['observe', 'decide', 'risk', 'review'])
    expect(r.trace.find((t) => t.participantId === 'decide')?.emits).toContain('order_proposal')
    expect(r.trace.find((t) => t.participantId === 'risk')?.orders.some((o) => o.includes('filled'))).toBe(true)
    expect(r.account?.positions['600160.SH']?.qty).toBe(100)
    expect(readBlackboard(r.runId, 'review')?.value).toEqual({ summary: '本轮一笔' })
    expect(listPendingDeliveries(r.runId)).toHaveLength(0)
  })

  it('reject 链：风控否决→不下单→白板拒因→复盘仍跑', async () => {
    setActors({ riskApproves: false })
    const r = await runCollaborationOnce(participants, seed)
    expect(r.trace.map((t) => t.participantId)).toEqual(['observe', 'decide', 'risk', 'review'])
    expect(r.account?.positions['600160.SH']).toBeUndefined()
    expect(r.account?.cash).toBe(100000)
    expect(readBlackboard(r.runId, 'risk_review')?.value).toMatchObject({ approved: false })
  })
})

describe('runCollaborationOnce — M5 团队配置生效', () => {
  it('observe_only：风控批准但 mode=observe_only → 跳过下单(只看不买)', async () => {
    setActors({ riskApproves: true })
    const r = await runCollaborationOnce(participants, { ...seed, mode: 'observe_only' })
    expect(r.account?.positions['600160.SH']).toBeUndefined()
    expect(r.account?.cash).toBe(100000)
    expect(r.trace.find((t) => t.participantId === 'risk')?.orders.some((o) => o.includes('observe_only'))).toBe(true)
  })

  it('黑名单：风控批准但标的在黑名单 → Risk Gate 拒、不成交', async () => {
    setActors({ riskApproves: true })
    const r = await runCollaborationOnce(participants, {
      ...seed,
      riskRules: { ...DEFAULT_RISK_RULES, blacklist: ['600160.SH'] },
    })
    expect(r.account?.positions['600160.SH']).toBeUndefined()
    expect(r.trace.find((t) => t.participantId === 'risk')?.orders.some((o) => o.includes('rejected'))).toBe(true)
  })
})
