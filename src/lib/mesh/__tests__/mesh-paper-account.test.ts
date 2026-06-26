/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

import { initAccount, getAccount, applyFill, setHalted, rollDayIfNeeded } from '../mesh-paper-account'

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

  it('rollDayIfNeeded：跨交易日清「当日计数」+ 刷新当日亏损基线（不再终身累计锁死）', () => {
    initAccount('r_day', 100000)
    // 第一天：成交几笔 + 亏一点
    applyFill('r_day', { symbol: 'X', side: 'buy', qty: 100, price: 50, fee: 5 })
    applyFill('r_day', { symbol: 'X', side: 'sell', qty: 100, price: 45, fee: 5 }) // realized = (45-50)*100 = -500
    const d1 = rollDayIfNeeded('r_day', '2026-06-26') // 首次设当日：基线=当前 realized、计数清零
    expect(d1.lastResetDay).toBe('2026-06-26')
    expect(d1.orderCount).toBe(0) // 当日计数清零
    expect(d1.notionalTraded).toBe(0)
    expect(d1.dayStartRealizedPnl).toBeCloseTo(-500) // 基线=终身已实现
    // 同一天再调：幂等，不重置
    applyFill('r_day', { symbol: 'X', side: 'buy', qty: 100, price: 50, fee: 5 })
    const same = rollDayIfNeeded('r_day', '2026-06-26')
    expect(same.orderCount).toBe(1) // 当天那笔仍在
    expect(same.dayStartRealizedPnl).toBeCloseTo(-500) // 基线不动
    // 跨到第二天：计数再清零，基线刷新为当前终身 realized（当日亏损从 0 起算）
    const d2 = rollDayIfNeeded('r_day', '2026-06-27')
    expect(d2.lastResetDay).toBe('2026-06-27')
    expect(d2.orderCount).toBe(0)
    expect(d2.dayStartRealizedPnl).toBeCloseTo(d2.realizedPnl) // 当日亏损 = realizedPnl - 基线 = 0
  })
})
