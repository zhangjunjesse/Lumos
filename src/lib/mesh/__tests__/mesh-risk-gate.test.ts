import { checkOrder } from '../mesh-risk-gate'
import { DEFAULT_RISK_RULES } from '../mesh-risk-rules'
import type { PaperAccount } from '../mesh-paper-account'

const snapshot = {
  ticks: [
    { code: 'A', last: 45, pct: 5 },
    { code: 'UP', last: 50, pct: 9.9 }, // 涨停
  ],
}

function acc(over: Partial<PaperAccount> = {}): PaperAccount {
  return {
    runId: 'r',
    cash: 100000,
    positions: {},
    realizedPnl: 0,
    feesPaid: 0,
    orderCount: 0,
    notionalTraded: 0,
    halted: false,
    ...over,
  }
}

describe('checkOrder (Risk Gate)', () => {
  it('正常买单通过，取快照现价', () => {
    const v = checkOrder({ symbol: 'A', side: 'buy', qty: 100 }, acc(), snapshot, DEFAULT_RISK_RULES)
    expect(v.ok).toBe(true)
    expect(v.price).toBe(45)
  })

  it('资金不足拒', () => {
    const v = checkOrder({ symbol: 'A', side: 'buy', qty: 100 }, acc({ cash: 100 }), snapshot, DEFAULT_RISK_RULES)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('资金不足')
  })

  it('涨停不追拒', () => {
    const v = checkOrder({ symbol: 'UP', side: 'buy', qty: 10 }, acc(), snapshot, DEFAULT_RISK_RULES)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('涨停')
  })

  it('黑名单拒', () => {
    const v = checkOrder({ symbol: 'A', side: 'buy', qty: 10 }, acc(), snapshot, { ...DEFAULT_RISK_RULES, blacklist: ['A'] })
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('黑名单')
  })

  it('超单笔金额拒', () => {
    const v = checkOrder({ symbol: 'A', side: 'buy', qty: 100 }, acc(), snapshot, { ...DEFAULT_RISK_RULES, maxOrderNotional: 1000 })
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('单笔金额')
  })

  it('卖出持仓不足拒', () => {
    const v = checkOrder({ symbol: 'A', side: 'sell', qty: 100 }, acc(), snapshot, DEFAULT_RISK_RULES)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('持仓不足')
  })

  it('非法行情价格拒，不让 NaN/Infinity 穿过总闸', () => {
    const badSnapshot = { ticks: [{ code: 'BAD', last: Number.NaN }] }
    const v = checkOrder({ symbol: 'BAD', side: 'buy', qty: 100 }, acc(), badSnapshot, DEFAULT_RISK_RULES)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('有效行情')
  })

  it('非整数数量拒', () => {
    const v = checkOrder({ symbol: 'A', side: 'buy', qty: 1.5 }, acc(), snapshot, DEFAULT_RISK_RULES)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('正整数')
  })

  it('总闸：单日亏损触线拒', () => {
    const v = checkOrder({ symbol: 'A', side: 'buy', qty: 10 }, acc({ realizedPnl: -25000 }), snapshot, DEFAULT_RISK_RULES)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('总闸')
  })

  it('总闸：已 halt 的账户一律拒', () => {
    const v = checkOrder({ symbol: 'A', side: 'buy', qty: 10 }, acc({ halted: true }), snapshot, DEFAULT_RISK_RULES)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('halt')
  })
})
