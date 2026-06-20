/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

import { initAccount, getAccount, applyFill, setHalted } from '../mesh-paper-account'

describe('mesh-paper-account', () => {
  it('init + buy：现金减、持仓加、均价正确', () => {
    initAccount('r1', 100000)
    const acc = applyFill('r1', { symbol: '600160.SH', side: 'buy', qty: 100, price: 45, fee: 5 })
    expect(acc.cash).toBeCloseTo(100000 - 100 * 45 - 5)
    expect(acc.positions['600160.SH']).toEqual({ qty: 100, avgPrice: 45 })
    expect(acc.orderCount).toBe(1)
    expect(acc.notionalTraded).toBeCloseTo(4500)
  })

  it('sell：现金加、清仓、realizedPnl 正确', () => {
    initAccount('r2', 100000)
    applyFill('r2', { symbol: 'X', side: 'buy', qty: 100, price: 40, fee: 5 })
    const acc = applyFill('r2', { symbol: 'X', side: 'sell', qty: 100, price: 45, fee: 5 })
    expect(acc.positions['X']).toBeUndefined()
    expect(acc.realizedPnl).toBeCloseTo((45 - 40) * 100)
  })

  it('setHalted 标记账户停摆', () => {
    initAccount('r3', 1000)
    setHalted('r3')
    expect(getAccount('r3')?.halted).toBe(true)
  })
})
