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
    dayStartRealizedPnl: 0,
    lastResetDay: null,
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
    const v = checkOrder({ symbol: 'UP', side: 'buy', qty: 100 }, acc(), snapshot, DEFAULT_RISK_RULES)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('涨停')
  })

  it('买入非整百股拒（A 股按手成交）', () => {
    const v = checkOrder({ symbol: 'A', side: 'buy', qty: 150 }, acc(), snapshot, DEFAULT_RISK_RULES)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('100 股整数倍')
  })

  it('卖出零股不受整百限制（清隔夜碎股）', () => {
    const v = checkOrder({ symbol: 'A', side: 'sell', qty: 50 }, acc({ positions: { A: { qty: 50, avgPrice: 40 } } }), snapshot, DEFAULT_RISK_RULES)
    expect(v.ok).toBe(true)
  })

  it('黑名单拒', () => {
    const v = checkOrder({ symbol: 'A', side: 'buy', qty: 100 }, acc(), snapshot, { ...DEFAULT_RISK_RULES, blacklist: ['A'] })
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

  it('总闸：单日亏损触线拒（无基线 → 当日亏损=realizedPnl）', () => {
    const v = checkOrder({ symbol: 'A', side: 'buy', qty: 100 }, acc({ realizedPnl: -25000 }), snapshot, DEFAULT_RISK_RULES)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('总闸')
  })

  it('总闸：单日亏损按日初基线算，终身累计亏损不误触发', () => {
    // 终身已实现 -1.5万，但今天开盘基线 -1万 → 当日亏损仅 -0.5万，不触发（默认线 2万）
    const v = checkOrder({ symbol: 'A', side: 'buy', qty: 100 }, acc({ realizedPnl: -15000, dayStartRealizedPnl: -10000 }), snapshot, DEFAULT_RISK_RULES)
    expect(v.ok).toBe(true)
  })

  it('总闸：已 halt 的账户一律拒', () => {
    const v = checkOrder({ symbol: 'A', side: 'buy', qty: 10 }, acc({ halted: true }), snapshot, DEFAULT_RISK_RULES)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('halt')
  })
})
