/**
 * paper 模拟账户 —— 现金 / 持仓 / 已实现盈亏 / 当日计数（供风控总闸）。
 * 每个协作 run 一个账户。不碰真钱、不连券商。
 */
import { getDb } from '@/lib/db/connection'

export interface Position {
  qty: number
  avgPrice: number
}

export interface PaperAccount {
  runId: string
  cash: number
  positions: Record<string, Position>
  realizedPnl: number
  feesPaid: number
  orderCount: number
  notionalTraded: number
  /** 当日已实现盈亏的日初基线：单日亏损总闸看 realizedPnl - dayStartRealizedPnl，而非终身累计。 */
  dayStartRealizedPnl: number
  /** 上次重置「当日计数」的交易日 YYYY-MM-DD；跨日时 rollDayIfNeeded 清零 orderCount/notionalTraded。 */
  lastResetDay: string | null
  halted: boolean
}

export interface FillInput {
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  price: number
  fee: number
}

interface AccountRow {
  run_id: string
  cash: number
  positions_json: string
  realized_pnl: number
  fees_paid: number
  order_count: number
  notional_traded: number
  day_start_realized_pnl: number
  last_reset_day: string | null
  halted: number
}

/** 默认模拟盘初始资金（开新 paper 账户用）。run-control 启动建账户、gateway 懒建都用它。 */
export const DEFAULT_PAPER_CASH = 100000

export function initAccount(runId: string, cash: number): PaperAccount {
  getDb().prepare('INSERT OR IGNORE INTO mesh_paper_account (run_id, cash) VALUES (?, ?)').run(runId, cash)
  return getAccount(runId)!
}

export function getAccount(runId: string): PaperAccount | null {
  const row = getDb().prepare('SELECT * FROM mesh_paper_account WHERE run_id = ?').get(runId) as AccountRow | undefined
  return row ? hydrate(row) : null
}

/** 记一笔成交：更新现金/持仓/已实现盈亏/手续费/计数/成交额。返回更新后账户。 */
export function applyFill(runId: string, fill: FillInput): PaperAccount {
  const acc = getAccount(runId)
  if (!acc) throw new Error(`paper account not found: ${runId}`)
  const positions = { ...acc.positions }
  const notional = fill.qty * fill.price
  let cash = acc.cash
  let realized = acc.realizedPnl

  if (fill.side === 'buy') {
    cash -= notional + fill.fee
    const cur = positions[fill.symbol] ?? { qty: 0, avgPrice: 0 }
    const newQty = cur.qty + fill.qty
    positions[fill.symbol] = {
      qty: newQty,
      avgPrice: newQty > 0 ? (cur.qty * cur.avgPrice + notional) / newQty : 0,
    }
  } else {
    cash += notional - fill.fee
    const cur = positions[fill.symbol] ?? { qty: 0, avgPrice: 0 }
    realized += (fill.price - cur.avgPrice) * fill.qty
    const newQty = cur.qty - fill.qty
    if (newQty <= 0) delete positions[fill.symbol]
    else positions[fill.symbol] = { qty: newQty, avgPrice: cur.avgPrice }
  }

  getDb()
    .prepare(
      `UPDATE mesh_paper_account
       SET cash=?, positions_json=?, realized_pnl=?, fees_paid=fees_paid+?,
           order_count=order_count+1, notional_traded=notional_traded+?, updated_at=datetime('now')
       WHERE run_id=?`,
    )
    .run(cash, JSON.stringify(positions), realized, fill.fee, notional, runId)
  return getAccount(runId)!
}

/** 触发总闸：标记账户停摆。 */
export function setHalted(runId: string): void {
  getDb().prepare("UPDATE mesh_paper_account SET halted=1, updated_at=datetime('now') WHERE run_id=?").run(runId)
}

/**
 * 跨交易日则把「当日计数」清零、把当日已实现盈亏基线设为当前 realizedPnl，返回最新账户。
 * 风控总闸的单日限额(笔数/金额/亏损)据此真正按日计——不再从开户终身累计把常驻团队逐渐锁死。
 * today 由调用方传交易日 key(YYYY-MM-DD，见 mesh-market-clock.dayKey)，便于测试注入。
 */
export function rollDayIfNeeded(runId: string, today: string): PaperAccount {
  const acc = getAccount(runId)
  if (!acc) throw new Error(`paper account not found: ${runId}`)
  if (acc.lastResetDay === today) return acc
  getDb()
    .prepare(
      `UPDATE mesh_paper_account
       SET order_count=0, notional_traded=0, day_start_realized_pnl=realized_pnl,
           last_reset_day=?, updated_at=datetime('now')
       WHERE run_id=?`,
    )
    .run(today, runId)
  return getAccount(runId)!
}

function hydrate(row: AccountRow): PaperAccount {
  return {
    runId: row.run_id,
    cash: row.cash,
    positions: safeParse(row.positions_json),
    realizedPnl: row.realized_pnl,
    feesPaid: row.fees_paid,
    orderCount: row.order_count,
    notionalTraded: row.notional_traded,
    dayStartRealizedPnl: row.day_start_realized_pnl,
    lastResetDay: row.last_reset_day,
    halted: row.halted === 1,
  }
}

function safeParse(json: string): Record<string, Position> {
  try {
    return (JSON.parse(json) as Record<string, Position>) || {}
  } catch {
    return {}
  }
}
