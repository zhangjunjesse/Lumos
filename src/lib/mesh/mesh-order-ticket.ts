/**
 * 交易票据 —— 每个 order_intent 的确定性执行凭证。
 * idempotency_key 唯一防重复下单；状态 pending → filled / rejected。
 */
import { randomUUID } from 'crypto'
import { getDb } from '@/lib/db/connection'

export type TicketStatus = 'pending' | 'filled' | 'rejected'

export interface OrderTicket {
  id: string
  runId: string
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  price: number
  filledQty: number | null
  status: TicketStatus
  rejectReason: string
  idempotencyKey: string
  mode: 'paper' | 'live'
}

export interface CreateTicketInput {
  runId: string
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  idempotencyKey: string
  mode: 'paper' | 'live'
}

interface TicketRow {
  id: string
  run_id: string
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  price: number
  filled_qty: number | null
  status: TicketStatus
  reject_reason: string
  idempotency_key: string
  mode: 'paper' | 'live'
}

/** 建 pending 票据；幂等键已存在则直接返回已有票据（防重复下单）。 */
export function createTicket(input: CreateTicketInput): OrderTicket {
  const existing = getTicketByIdempotencyKey(input.idempotencyKey)
  if (existing) return existing
  const id = `tkt_${randomUUID()}`
  getDb()
    .prepare(
      `INSERT INTO mesh_order_ticket (id, run_id, symbol, side, qty, idempotency_key, mode)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.runId, input.symbol, input.side, input.qty, input.idempotencyKey, input.mode)
  return getTicket(id)!
}

export function fillTicket(id: string, price: number, filledQty: number, riskSnapshot: unknown): void {
  getDb()
    .prepare(
      "UPDATE mesh_order_ticket SET status='filled', price=?, filled_qty=?, risk_snapshot_json=?, filled_at=datetime('now') WHERE id=?",
    )
    .run(price, filledQty, JSON.stringify(riskSnapshot ?? {}), id)
}

export function rejectTicket(id: string, reason: string, riskSnapshot: unknown): void {
  getDb()
    .prepare("UPDATE mesh_order_ticket SET status='rejected', reject_reason=?, risk_snapshot_json=? WHERE id=?")
    .run(reason, JSON.stringify(riskSnapshot ?? {}), id)
}

export function markTicketPendingReview(id: string, reason: string, riskSnapshot: unknown): void {
  getDb()
    .prepare(
      "UPDATE mesh_order_ticket SET status='pending', reject_reason=?, risk_snapshot_json=? WHERE id=? AND status='pending'",
    )
    .run(reason, JSON.stringify(riskSnapshot ?? {}), id)
}

export function getTicket(id: string): OrderTicket | null {
  const row = getDb().prepare('SELECT * FROM mesh_order_ticket WHERE id=?').get(id) as TicketRow | undefined
  return row ? hydrate(row) : null
}

export function getTicketByIdempotencyKey(key: string): OrderTicket | null {
  const row = getDb().prepare('SELECT * FROM mesh_order_ticket WHERE idempotency_key=?').get(key) as
    | TicketRow
    | undefined
  return row ? hydrate(row) : null
}

function hydrate(r: TicketRow): OrderTicket {
  return {
    id: r.id,
    runId: r.run_id,
    symbol: r.symbol,
    side: r.side,
    qty: r.qty,
    price: r.price,
    filledQty: r.filled_qty,
    status: r.status,
    rejectReason: r.reject_reason,
    idempotencyKey: r.idempotency_key,
    mode: r.mode,
  }
}
