/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

import { placeOrder } from '../mesh-order-gateway'
import { initAccount, getAccount } from '../mesh-paper-account'

const snapshot = { ticks: [{ code: '600160.SH', last: 45, pct: 5 }] }

describe('placeOrder (paper)', () => {
  it('过 Risk Gate → paper 成交 + 账户记账 + ticket filled', () => {
    initAccount('g1', 100000)
    const r = placeOrder('g1', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'g1-1', snapshot })
    expect(r.filled).toBe(true)
    expect(r.status).toBe('filled')
    expect(r.price).toBe(45)
    const acc = getAccount('g1')!
    expect(acc.positions['600160.SH'].qty).toBe(100)
    expect(acc.cash).toBeLessThan(100000)
  })

  it('资金不足 → ticket rejected，账户不动', () => {
    initAccount('g2', 100)
    const r = placeOrder('g2', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'g2-1', snapshot })
    expect(r.filled).toBe(false)
    expect(r.status).toBe('rejected')
    expect(r.reason).toContain('资金不足')
    expect(getAccount('g2')!.cash).toBe(100)
  })

  it('幂等：同 key 不重复撮合（钱只扣一次）', () => {
    initAccount('g3', 100000)
    const r1 = placeOrder('g3', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'g3-1', snapshot })
    const cashAfter1 = getAccount('g3')!.cash
    const r2 = placeOrder('g3', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'g3-1', snapshot })
    expect(r2.ticketId).toBe(r1.ticketId)
    expect(getAccount('g3')!.cash).toBe(cashAfter1)
  })

  it('live 后端未接入 → 抛错（绝不误下真单）', () => {
    initAccount('g4', 100000)
    expect(() =>
      placeOrder('g4', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'g4-1', snapshot, mode: 'live' }),
    ).toThrow('live backend not wired')
  })
})
