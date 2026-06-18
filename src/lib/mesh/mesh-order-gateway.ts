/**
 * OrderGateway —— 唯一持"撮合/下单"能力的确定性服务。
 * agent 物理够不到（不是 MCP/工具，只由 runtime 内部调用）。
 * 流程：建票据 → Risk Gate 总闸 → 过则按 mode 撮合：paper 本地撮合 / live 走 Python 子进程真下单。
 * 真钱安全：live 默认关；超时/崩溃自动 halt 且 ticket 留 pending（不可当成交）；幂等键防重下单。
 */
import { createTicket, fillTicket, rejectTicket, type OrderTicket } from './mesh-order-ticket'
import { getAccount, applyFill, setHalted } from './mesh-paper-account'
import { checkOrder, type OrderIntent, type RiskVerdict } from './mesh-risk-gate'
import { DEFAULT_RISK_RULES, type RiskRules } from './mesh-risk-rules'
import { liveBackend, LiveBackendError } from './mesh-live-backend'

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
  /** live 总开关：默认关；关时 live 单直接拒、不碰后端（真钱保险）。 */
  liveEnabled?: boolean
}

export async function placeOrder(
  runId: string,
  intent: OrderIntent,
  options: PlaceOrderOptions,
): Promise<PlaceOrderResult> {
  const mode = options.mode ?? 'paper'
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
  // 幂等：已终态票据直接返回，不重复撮合/下单
  if (ticket.status !== 'pending') {
    return { ticketId: ticket.id, status: ticket.status, filled: ticket.status === 'filled', reason: ticket.rejectReason, price: ticket.price }
  }

  const account = getAccount(accountId)
  if (!account) throw new Error(`paper account not found: ${accountId}`)
  const verdict: RiskVerdict = checkOrder(intent, account, options.snapshot, rules)
  const riskSnapshot = { verdict, mode }

  // 确定性总闸（不经 LLM）：不过即拒，触线 halt
  if (!verdict.ok) {
    rejectTicket(ticket.id, verdict.reason, riskSnapshot)
    if (verdict.reason.includes('总闸')) setHalted(accountId)
    return { ticketId: ticket.id, status: 'rejected', filled: false, reason: verdict.reason, price: verdict.price }
  }

  if (mode === 'live') {
    return placeLiveOrder(accountId, ticket.id, intent, verdict, options)
  }

  // paper 本地撮合
  applyFill(accountId, { symbol: intent.symbol, side: intent.side, qty: intent.qty, price: verdict.price, fee: verdict.fee })
  fillTicket(ticket.id, verdict.price, riskSnapshot)
  return { ticketId: ticket.id, status: 'filled', filled: true, reason: '', price: verdict.price }
}

/** live 下单：过总闸后走 Python 子进程；live 默认关；异常按真钱安全语义处置。 */
async function placeLiveOrder(
  accountId: string,
  ticketId: string,
  intent: OrderIntent,
  verdict: RiskVerdict,
  options: PlaceOrderOptions,
): Promise<PlaceOrderResult> {
  if (!options.liveEnabled) {
    rejectTicket(ticketId, 'live 未启用（需显式开启）', { mode: 'live' })
    return { ticketId, status: 'rejected', filled: false, reason: 'live 未启用（需显式开启）', price: verdict.price }
  }
  try {
    const r = await liveBackend().placeOrder({
      symbol: intent.symbol,
      side: intent.side,
      qty: intent.qty,
      price: verdict.price,
      idempotencyKey: options.idempotencyKey,
    })
    if (r.status === 'filled') {
      const fillPrice = r.filledPrice ?? verdict.price
      const fillQty = r.filledQty ?? intent.qty
      applyFill(accountId, { symbol: intent.symbol, side: intent.side, qty: fillQty, price: fillPrice, fee: verdict.fee })
      fillTicket(ticketId, fillPrice, { live: r })
      return { ticketId, status: 'filled', filled: true, reason: '', price: fillPrice }
    }
    rejectTicket(ticketId, r.reason ?? '券商拒单', { live: r })
    return { ticketId, status: 'rejected', filled: false, reason: r.reason ?? '券商拒单', price: verdict.price }
  } catch (err) {
    const kind = err instanceof LiveBackendError ? err.kind : 'unknown'
    const msg = err instanceof Error ? err.message : String(err)
    // 真钱安全：超时/崩溃/spawn 失败 → 自动 halt，ticket 留 pending（不可当成交、不可盲目重下，需人工核对）
    if (kind === 'timeout' || kind === 'crash' || kind === 'spawn') {
      setHalted(accountId)
      return { ticketId, status: 'pending', filled: false, reason: `${msg}（已 halt，需人工核对）`, price: verdict.price }
    }
    // protocol 等明确错误 → 拒单
    rejectTicket(ticketId, msg, { live: { error: msg } })
    return { ticketId, status: 'rejected', filled: false, reason: msg, price: verdict.price }
  }
}
