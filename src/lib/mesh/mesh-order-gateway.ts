/**
 * OrderGateway —— 唯一持"撮合/下单"能力的确定性服务。
 * agent 物理够不到（不是 MCP/工具，只由 runtime 内部调用）。
 * 流程：建票据 → Risk Gate → 过则 paper 撮合记账 + ticket filled；拒则 ticket rejected。
 * live 后端未接入（M2 paper only），调用即抛错以确保不会误下真单。
 */
import { createTicket, fillTicket, rejectTicket, type OrderTicket } from './mesh-order-ticket'
import { getAccount, applyFill, setHalted } from './mesh-paper-account'
import { checkOrder, type OrderIntent, type RiskVerdict } from './mesh-risk-gate'
import { DEFAULT_RISK_RULES, type RiskRules } from './mesh-risk-rules'

export interface PlaceOrderResult {
  ticketId: string
  status: OrderTicket['status']
  filled: boolean
  reason: string
  price: number
}

export interface PlaceOrderOptions {
  idempotencyKey: string
  snapshot: unknown
  mode?: 'paper' | 'live'
  rules?: RiskRules
  /** 账户标识：常驻团队跨轮共享同一账户；缺省回落 runId（单轮即 per-run 账户，行为不变）。 */
  accountId?: string
}

export function placeOrder(runId: string, intent: OrderIntent, options: PlaceOrderOptions): PlaceOrderResult {
  const mode = options.mode ?? 'paper'
  if (mode === 'live') {
    throw new Error('OrderGateway: live backend not wired (M2 paper only)')
  }
  const accountId = options.accountId ?? runId
  const rules = options.rules ?? DEFAULT_RISK_RULES
  const ticket = createTicket({
    runId,
    symbol: intent.symbol,
    side: intent.side,
    qty: intent.qty,
    idempotencyKey: options.idempotencyKey,
    mode,
  })
  // 幂等：已终态票据直接返回，不重复撮合
  if (ticket.status !== 'pending') {
    return { ticketId: ticket.id, status: ticket.status, filled: ticket.status === 'filled', reason: ticket.rejectReason, price: ticket.price }
  }

  const account = getAccount(accountId)
  if (!account) throw new Error(`paper account not found: ${accountId}`)
  const verdict: RiskVerdict = checkOrder(intent, account, options.snapshot, rules)
  const riskSnapshot = { verdict, mode }

  if (!verdict.ok) {
    rejectTicket(ticket.id, verdict.reason, riskSnapshot)
    if (verdict.reason.includes('总闸')) setHalted(accountId) // 总闸触发 → 账户停摆
    return { ticketId: ticket.id, status: 'rejected', filled: false, reason: verdict.reason, price: verdict.price }
  }

  applyFill(accountId, { symbol: intent.symbol, side: intent.side, qty: intent.qty, price: verdict.price, fee: verdict.fee })
  fillTicket(ticket.id, verdict.price, riskSnapshot)
  return { ticketId: ticket.id, status: 'filled', filled: true, reason: '', price: verdict.price }
}
