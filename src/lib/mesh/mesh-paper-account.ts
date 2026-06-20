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
  halted: number
}

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

function hydrate(row: AccountRow): PaperAccount {
  return {
    runId: row.run_id,
    cash: row.cash,
    positions: safeParse(row.positions_json),
    realizedPnl: row.realized_pnl,
    feesPaid: row.fees_paid,
    orderCount: row.order_count,
    notionalTraded: row.notional_traded,
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
