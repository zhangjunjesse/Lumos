/**
 * OrderGateway —— 唯一持"撮合/下单"能力的确定性服务。
 * agent 物理够不到（不是 MCP/工具，只由 runtime 内部调用）。
 * 流程：建票据 → Risk Gate 总闸 → 过则按 mode 撮合：paper 本地撮合 / live 走 Python 子进程真下单。
 * 真钱安全：live 默认关；超时/崩溃自动 halt 且 ticket 留 pending（不可当成交）；幂等键防重下单。
 */
import {
  createTicket,
  fillTicket,
  getTicketByIdempotencyKey,
  markTicketPendingReview,
  rejectTicket,
  type OrderTicket,
} from './mesh-order-ticket'
import { getAccount, initAccount, applyFill, setHalted, rollDayIfNeeded, DEFAULT_PAPER_CASH } from './mesh-paper-account'
import { dayKey } from './mesh-market-clock'
import { calculateOrderFee, checkOrder, type OrderIntent, type RiskVerdict } from './mesh-risk-gate'
import { DEFAULT_RISK_RULES, type RiskRules } from './mesh-risk-rules'
import { isLiveBackendConfigured, liveBackend, LiveBackendError } from './mesh-live-backend'

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

// 每账户串行锁：并发下单按账户排队执行，杜绝「读账户 → await 真盘下单 → 写账户」之间被另一笔覆盖现金(live 竞态)。
// paper 路径本就同步无竞态，加锁也无害(立即接力)。Map 按 accountId 覆盖、数量有界(每工作室一个)，不无限增长。
const accountLocks = new Map<string, Promise<unknown>>()
function withAccountLock<T>(accountId: string, fn: () => Promise<T>): Promise<T> {
  const prev = accountLocks.get(accountId) ?? Promise.resolve()
  const run = prev.then(fn, fn) // 排在前一笔之后(无论其成败都接力)
  accountLocks.set(accountId, run.then(() => {}, () => {})) // 链上保活，吞错不传染给下一笔
  return run
}

export async function placeOrder(
  runId: string,
  intent: OrderIntent,
  options: PlaceOrderOptions,
): Promise<PlaceOrderResult> {
  const accountId = options.accountId ?? runId
  return withAccountLock(accountId, () => placeOrderInner(runId, intent, options, accountId))
}

async function placeOrderInner(
  runId: string,
  intent: OrderIntent,
  options: PlaceOrderOptions,
  accountId: string,
): Promise<PlaceOrderResult> {
  const mode = options.mode ?? 'paper'
  const rules = options.rules ?? DEFAULT_RISK_RULES
  const existingTicket = getTicketByIdempotencyKey(options.idempotencyKey)
  const ticket =
    existingTicket ??
    createTicket({
      runId,
      symbol: intent.symbol,
      side: intent.side,
      qty: intent.qty,
      idempotencyKey: options.idempotencyKey,
      mode,
    })
  // 已存在的 live pending 代表券商侧状态未知，只能人工核对，不能重试或覆盖成其它状态。
  if (existingTicket?.status === 'pending' && existingTicket.mode === 'live') {
    return {
      ticketId: existingTicket.id,
      status: 'pending',
      filled: false,
      reason: existingTicket.rejectReason || 'live 订单仍处于 pending，需人工核对券商状态后处理',
      price: existingTicket.price,
    }
  }
  // 幂等：已终态票据直接返回，不重复撮合/下单。
  if (ticket.status !== 'pending') {
    return { ticketId: ticket.id, status: ticket.status, filled: ticket.status === 'filled', reason: ticket.rejectReason, price: ticket.price }
  }

  // paper 账户按需懒建：团队启动后中途加入下单成员、或聊天即时下单时账户可能还没建。
  // live 缺账户属配置错误，保持 throw（不为真盘自动凭空建账户）。
  const ensured = getAccount(accountId) ?? (mode === 'paper' ? initAccount(accountId, DEFAULT_PAPER_CASH) : null)
  // paper 上面已懒建,走不到这；这里只剩 live：live 缺账户属配置错误,不为真盘凭空建账户,报清楚是 live 账户问题。
  if (!ensured) throw new Error(`live 账户不存在(需先建账户/配置): ${accountId}`)
  // 跨交易日先清「当日计数」、刷新当日亏损基线，再过总闸——否则单日笔数/金额/亏损会从开户终身累计、把常驻团队锁死。
  const account = rollDayIfNeeded(accountId, dayKey(new Date()))
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
  fillTicket(ticket.id, verdict.price, intent.qty, riskSnapshot)
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
  if (!isLiveBackendConfigured()) {
    rejectTicket(ticketId, 'live 后端脚本未配置（需设置 LUMOS_MESH_LIVE_BACKEND）', { mode: 'live' })
    return {
      ticketId,
      status: 'rejected',
      filled: false,
      reason: 'live 后端脚本未配置（需设置 LUMOS_MESH_LIVE_BACKEND）',
      price: verdict.price,
    }
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
      if (!isFinitePositiveNumber(r.filledPrice) || !isFinitePositiveInteger(r.filledQty)) {
        return markLiveUnknown(accountId, ticketId, verdict.price, 'live 回执缺少有效成交价或成交量', { live: r })
      }
      const fillPrice = r.filledPrice
      const fillQty = r.filledQty
      if (fillQty > intent.qty) {
        return markLiveUnknown(accountId, ticketId, verdict.price, 'live 回执成交数量超过下单数量', { live: r })
      }
      if (fillPrice > verdict.price) {
        return markLiveUnknown(accountId, ticketId, verdict.price, 'live 回执成交价高于请求限价', { live: r })
      }
      const fee = calculateOrderFee(fillQty * fillPrice)
      applyFill(accountId, { symbol: intent.symbol, side: intent.side, qty: fillQty, price: fillPrice, fee })
      fillTicket(ticketId, fillPrice, fillQty, { live: r }) // 部分成交据实记 filled_qty(可能 < 下单 qty)
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
      markTicketPendingReview(ticketId, `${msg}（已 halt，需人工核对）`, { live: { error: msg, kind } })
      return { ticketId, status: 'pending', filled: false, reason: `${msg}（已 halt，需人工核对）`, price: verdict.price }
    }
    // protocol 等明确错误 → 拒单
    rejectTicket(ticketId, msg, { live: { error: msg } })
    return { ticketId, status: 'rejected', filled: false, reason: msg, price: verdict.price }
  }
}

function markLiveUnknown(
  accountId: string,
  ticketId: string,
  requestPrice: number,
  reason: string,
  snapshot: unknown,
): PlaceOrderResult {
  setHalted(accountId)
  markTicketPendingReview(ticketId, `${reason}（已 halt，需人工核对）`, snapshot)
  return {
    ticketId,
    status: 'pending',
    filled: false,
    reason: `${reason}（已 halt，需人工核对）`,
    price: requestPrice,
  }
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isFinitePositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
}
