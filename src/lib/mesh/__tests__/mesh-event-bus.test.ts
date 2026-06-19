/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

import {
  persistMessage,
  markDelivered,
  listPendingDeliveries,
  subscribe,
  wake,
  findTaskFrom,
  listAllMessages,
} from '../mesh-event-bus'

describe('mesh-event-bus — per-subscriber delivery', () => {
  it('one event creates one pending delivery per subscriber', () => {
    const mid = persistMessage('run-1', 'quote_anomaly', { code: 'x' }, 'observe', ['decide', 'risk'])
    const pending = listPendingDeliveries('run-1')
    expect(pending).toHaveLength(2)
    expect(pending.map((p) => p.subscriberId).sort()).toEqual(['decide', 'risk'])
    expect(pending[0].messageId).toBe(mid)
    expect(pending[0].payload).toEqual({ code: 'x' })
    expect(pending[0].topic).toBe('quote_anomaly')
  })

  it('markDelivered consumes only that subscriber — others keep their delivery', () => {
    persistMessage('run-2', 't', {}, 'a', ['b', 'c'])
    const before = listPendingDeliveries('run-2')
    markDelivered(before[0].messageId, 'b')
    const after = listPendingDeliveries('run-2')
    expect(after).toHaveLength(1)
    expect(after[0].subscriberId).toBe('c')
  })
})

describe('mesh-event-bus — in-process wake', () => {
  it('notifies live subscribers and stops after unsubscribe', () => {
    const seen: string[] = []
    const unsub = subscribe('run-3', 'topicX', (e) => seen.push(e.id))
    wake('run-3', 'topicX', { id: 'e1', runId: 'run-3', topic: 'topicX', payload: null, from: 'a' })
    unsub()
    wake('run-3', 'topicX', { id: 'e2', runId: 'run-3', topic: 'topicX', payload: null, from: 'a' })
    expect(seen).toEqual(['e1'])
  })
})

describe('mesh-event-bus — send_task / reply（M6）', () => {
  it('定向任务带 taskId，投递给收件人，findTaskFrom 找到派发者', () => {
    persistMessage('t1', 'agent_task', { summary: '审买入 X' }, 'stock.decide', ['stock.risk'], 'task-1')
    expect(findTaskFrom('t1', 'task-1')).toBe('stock.decide')
    const all = listAllMessages('t1')
    expect(all[0].topic).toBe('agent_task')
    expect(all[0].taskId).toBe('task-1')
    const pending = listPendingDeliveries('t1')
    expect(pending.map((p) => p.subscriberId)).toEqual(['stock.risk'])
    expect(pending[0].taskId).toBe('task-1')
  })

  it('回执配对 taskId，投递给原派发者', () => {
    persistMessage('t2', 'agent_task', { summary: 'x' }, 'stock.decide', ['stock.risk'], 'task-2')
    const from = findTaskFrom('t2', 'task-2')!
    expect(from).toBe('stock.decide')
    persistMessage('t2', 'agent_reply', { summary: '批准', taskId: 'task-2' }, 'stock.risk', [from], 'task-2')
    const reply = listAllMessages('t2').find((m) => m.topic === 'agent_reply')!
    expect(reply.from).toBe('stock.risk')
    expect(reply.taskId).toBe('task-2')
    expect(listPendingDeliveries('t2').filter((p) => p.subscriberId === 'stock.decide')).toHaveLength(1)
  })

  it('普通 event 无 taskId；findTaskFrom 不存在返回 null', () => {
    persistMessage('t3', 'quote_anomaly', { code: 'X' }, 'stock.observe', ['stock.decide'])
    expect(listAllMessages('t3')[0].taskId).toBeNull()
    expect(findTaskFrom('t3', 'nope')).toBeNull()
  })
})
