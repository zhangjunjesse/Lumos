/**
 * Risk Gate —— 确定性风控裁决，不依赖 LLM。任一规则不过即 ok=false。
 * 总闸（halt / 单日亏损 / 笔数 / 金额）最高优先级先判。成交价取行情快照。
 */
import type { PaperAccount } from './mesh-paper-account'
import type { RiskRules } from './mesh-risk-rules'

export interface OrderIntent {
  symbol: string
  side: 'buy' | 'sell'
  qty: number
}

export interface MarketTick {
  code: string
  last: number
  pct?: number
  limitUp?: boolean
}

export interface RiskVerdict {
  ok: boolean
  reason: string
  price: number
  fee: number
}

const FEE_RATE = 0.0003
const MIN_FEE = 5

export function calculateOrderFee(notional: number): number {
  if (!Number.isFinite(notional) || notional < 0) return MIN_FEE
  return Math.max(MIN_FEE, notional * FEE_RATE)
}

function findTick(snapshot: unknown, symbol: string): MarketTick | null {
  const ticks = (snapshot as { ticks?: MarketTick[] })?.ticks
  if (!Array.isArray(ticks)) return null
  return ticks.find((t) => t.code === symbol) ?? null
}

function positionsNotional(account: PaperAccount, snapshot: unknown): number {
  let sum = 0
  for (const [sym, pos] of Object.entries(account.positions)) {
    const tick = findTick(snapshot, sym)
    sum += pos.qty * (tick?.last ?? pos.avgPrice)
  }
  return sum
}

export function checkOrder(
  intent: OrderIntent,
  account: PaperAccount,
  snapshot: unknown,
  rules: RiskRules,
): RiskVerdict {
  const tick = findTick(snapshot, intent.symbol)
  const price = tick?.last ?? 0
  const notional = intent.qty * price
  const fee = calculateOrderFee(notional)
  const fail = (reason: string): RiskVerdict => ({ ok: false, reason, price, fee })

  // 总闸（最高优先级）
  if (account.halted) return fail('账户已触发总闸 halt')
  if (account.realizedPnl - account.dayStartRealizedPnl <= -rules.maxDailyLossAbs) return fail(`触发单日最大亏损总闸(${rules.maxDailyLossAbs})`)
  if (account.orderCount >= rules.maxOrderCount) return fail(`触发单日最大下单笔数总闸(${rules.maxOrderCount})`)
  if (account.notionalTraded + notional > rules.maxDailyNotional)
    return fail(`触发单日最大下单金额总闸(${rules.maxDailyNotional})`)

  // 基础校验
  if (!tick || !Number.isFinite(price) || price <= 0) return fail(`无该标的有效行情：${intent.symbol}`)
  if (!Number.isInteger(intent.qty) || intent.qty <= 0) return fail('下单数量必须为正整数')
  if (rules.blacklist.includes(intent.symbol)) return fail('标的在黑名单')
  if (notional > rules.maxOrderNotional) return fail(`超单笔金额上限(${rules.maxOrderNotional})`)

  if (intent.side === 'buy') {
    // A 股买入按手(100 股)成交,非整百券商会直接拒——确定性挡在前面,别让它走到撮合。卖出可有零股(清隔夜碎股)故不限。
    if (intent.qty % 100 !== 0) return fail('买入数量须为 100 股整数倍')
    if (rules.noChaseLimitUp && (tick.limitUp || (tick.pct ?? 0) >= 9.8)) return fail('涨停不追')
    if (account.cash < notional + fee)
      return fail(`可用资金不足(需 ${(notional + fee).toFixed(2)}，有 ${account.cash.toFixed(2)})`)
    const curQty = account.positions[intent.symbol]?.qty ?? 0
    if (curQty + intent.qty > rules.maxSymbolQty) return fail(`超单票持仓上限(${rules.maxSymbolQty})`)
    if (positionsNotional(account, snapshot) + notional > rules.maxTotalNotional)
      return fail(`超总持仓市值上限(${rules.maxTotalNotional})`)
  } else {
    const curQty = account.positions[intent.symbol]?.qty ?? 0
    if (curQty < intent.qty) return fail(`持仓不足以卖出(有 ${curQty}，卖 ${intent.qty})`)
  }

  return { ok: true, reason: '', price, fee }
}
