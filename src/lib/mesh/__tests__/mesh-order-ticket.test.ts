/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

import { createTicket, fillTicket, rejectTicket, getTicket } from '../mesh-order-ticket'

describe('mesh-order-ticket', () => {
  it('create 是 pending', () => {
    const t = createTicket({ runId: 'r1', symbol: 'X', side: 'buy', qty: 100, idempotencyKey: 'k1', mode: 'paper' })
    expect(t.status).toBe('pending')
  })

  it('幂等：同 idempotency_key 返回同票，不被新参数覆盖', () => {
    const a = createTicket({ runId: 'r2', symbol: 'X', side: 'buy', qty: 100, idempotencyKey: 'k2', mode: 'paper' })
    const b = createTicket({ runId: 'r2', symbol: 'X', side: 'buy', qty: 999, idempotencyKey: 'k2', mode: 'paper' })
    expect(b.id).toBe(a.id)
    expect(b.qty).toBe(100)
  })

  it('fill / reject 改状态', () => {
    const t = createTicket({ runId: 'r3', symbol: 'X', side: 'buy', qty: 100, idempotencyKey: 'k3', mode: 'paper' })
    fillTicket(t.id, 45, 100, {})
    expect(getTicket(t.id)?.status).toBe('filled')
    expect(getTicket(t.id)?.price).toBe(45)
    expect(getTicket(t.id)?.filledQty).toBe(100)

    const t2 = createTicket({ runId: 'r3', symbol: 'Y', side: 'sell', qty: 50, idempotencyKey: 'k4', mode: 'paper' })
    rejectTicket(t2.id, '资金不足', {})
    expect(getTicket(t2.id)?.status).toBe('rejected')
    expect(getTicket(t2.id)?.rejectReason).toBe('资金不足')
  })

  it('部分成交：filled_qty 记实际成交量(< 下单 qty)，下单 qty 保留', () => {
    const t = createTicket({ runId: 'r5', symbol: 'Z', side: 'buy', qty: 100, idempotencyKey: 'k5', mode: 'live' })
    fillTicket(t.id, 45, 60, {}) // 下单 100,只成交 60
    const got = getTicket(t.id)
    expect(got?.status).toBe('filled')
    expect(got?.qty).toBe(100) // 下单量保留
    expect(got?.filledQty).toBe(60) // 实际成交量
  })
})
