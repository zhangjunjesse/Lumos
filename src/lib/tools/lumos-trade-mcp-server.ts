/**
 * lumos-trade —— 普通聊天里的股票下单工具（in-process MCP）。
 *
 * 真钱安全（铁律，与炒股团队同一套，绝不弱化）：
 * - place_order 不直接下单；它经 canUseTool 弹「确认框」，用户点确认后才执行（见 claude-client
 *   的权限链——本工具刻意不进自动批准白名单，只有只读的 preview_order 自动批准）。
 * - 开了「跳过权限」(dangerously_skip_permissions) 时直接拒：真钱不容无确认执行。
 * - 确认后过确定性 RiskGate 总闸（单日亏损/笔数/金额/价格笼子），再由 OrderGateway（唯一下单权）
 *   撮合：paper 本地 / 真盘 走 qmt 子进程。下单能力只在 OrderGateway，模型够不到。
 * - 默认 paper；真盘需在「炒股团队→工作室设置」开真盘开关（带确认词）——本工具只是复用该开关。
 * 账户/风控/真盘门全部复用 buildTradeContext(默认工作室)，与团队完全一致。
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { getSetting } from '@/lib/db'
import { DEFAULT_WORKSHOP_ID } from '@/lib/mesh/mesh-constants'
import { buildTradeContext } from '@/lib/mesh/mesh-session-context'
import { getAccount, initAccount } from '@/lib/mesh/mesh-paper-account'
import { placeOrder } from '@/lib/mesh/mesh-order-gateway'
import { checkOrder, calculateOrderFee, type OrderIntent } from '@/lib/mesh/mesh-risk-gate'
import { DEFAULT_RISK_RULES } from '@/lib/mesh/mesh-risk-rules'
import { ensureQuoteFeed, fetchTicksOnDemand, getQuoteSnapshot } from '@/lib/mesh/mesh-quote-feed'

export const LUMOS_TRADE_MCP_SERVER_NAME = 'lumos-trade'

export const LUMOS_TRADE_MCP_SYSTEM_HINT = `你有股票交易工具（lumos-trade，默认走默认炒股工作室的账户）。用户要买/卖股票时：
1. 先调 preview_order 看现价、预估金额、是「模拟盘」还是「真盘」、风控是否通过，并把这些清楚告诉用户（务必说明是模拟盘还是真盘）。
2. 用户确认要下单时调 place_order —— 它会弹确认框等用户点确认后才真正下单并过风控总闸。绝不要绕过 place_order 自行声称已下单或已成交。
要求：股数必须是 100 的整数倍；股票代码要带交易所后缀（沪市 .SH / 深市 .SZ，如 600519.SH）。`

// 聊天首次下单时若默认工作室账户尚未建（用户没进过炒股团队）→ 用模拟盘默认资金建一个，
// 让聊天下单开箱即用（纯 paper，无真钱）；真盘资金以券商实账为准，与此无关。
const DEFAULT_PAPER_CASH = 1_000_000

interface OrderArgs {
  symbol: string
  side: 'buy' | 'sell'
  qty: number
}

function ensureDefaultAccount(): string {
  if (!getAccount(DEFAULT_WORKSHOP_ID)) initAccount(DEFAULT_WORKSHOP_ID, DEFAULT_PAPER_CASH)
  return DEFAULT_WORKSHOP_ID
}

/** 现价：行情桥缓存有则用；没有则按需现取（不在自选也能取）。0=拿不到（非交易时段/无 qmt）。 */
async function resolvePrice(accountId: string, sessionId: string, symbol: string): Promise<number> {
  ensureQuoteFeed(accountId, `chat:${sessionId}`)
  const cached = getQuoteSnapshot(accountId).ticks.find((t) => t.code === symbol)?.last
  if (cached && cached > 0) return cached
  const fresh = await fetchTicksOnDemand(accountId, [symbol])
  return fresh.find((t) => t.code === symbol)?.last ?? 0
}

/** 预览（只读）：现价 + 预估金额 + 模拟/真盘 + 风控是否通过。 */
export async function previewOrder(sessionId: string, args: OrderArgs): Promise<Record<string, unknown>> {
  const accountId = ensureDefaultAccount()
  const tc = buildTradeContext(DEFAULT_WORKSHOP_ID)
  const account = getAccount(accountId)!
  const price = await resolvePrice(accountId, sessionId, args.symbol)
  const modeLabel = tc.tradeMode === 'live' ? '真盘' : '模拟盘'
  if (!(price > 0)) {
    return {
      ok: false,
      mode: modeLabel,
      reason: `拿不到 ${args.symbol} 的实时价（行情桥未就绪 / 非交易时段 / 本机无 qmt），无法预览，也无法下单。`,
    }
  }
  const intent: OrderIntent = { symbol: args.symbol, side: args.side, qty: args.qty }
  const verdict = checkOrder(intent, account, { ticks: [{ code: args.symbol, last: price, pct: null }] }, tc.rules ?? DEFAULT_RISK_RULES)
  return {
    ok: true,
    symbol: args.symbol,
    side: args.side,
    qty: args.qty,
    price,
    estimated_amount: Math.round(price * args.qty * 100) / 100,
    fee: calculateOrderFee(price * args.qty),
    mode: modeLabel,
    risk_pass: verdict.ok,
    risk_reason: verdict.ok ? undefined : verdict.reason,
    note: '这只是预览。真正下单请调用 place_order，会弹确认框等用户确认后才执行。',
  }
}

/** 下单：跳过权限模式直接拒（真钱保险）；否则过 OrderGateway（已在 canUseTool 拿到用户确认）。 */
export async function submitOrder(sessionId: string, args: OrderArgs): Promise<Record<string, unknown>> {
  // 真钱保险：开了「跳过权限」就弹不出确认框 → 直接拒，绝不无确认下单。
  if (getSetting('dangerously_skip_permissions') === 'true') {
    return { ok: false, reason: '当前开了「跳过权限」，交易不能在无确认下执行。请到设置关闭「跳过权限」后再下单。' }
  }
  const accountId = ensureDefaultAccount()
  const tc = buildTradeContext(DEFAULT_WORKSHOP_ID)
  ensureQuoteFeed(accountId, `chat:${sessionId}`)
  const result = await placeOrder(
    `chat:${sessionId}`,
    { symbol: args.symbol, side: args.side, qty: args.qty },
    {
      idempotencyKey: `chat:${sessionId}:${args.symbol}:${args.side}:${args.qty}:${Date.now()}`,
      snapshot: getQuoteSnapshot(accountId), // placeOrder 内部会按需补该股实时价
      rules: tc.rules,
      accountId,
      mode: tc.tradeMode,
      liveEnabled: tc.liveEnabled,
    },
  )
  return {
    ok: result.filled,
    status: result.status, // filled / rejected / pending
    mode: tc.tradeMode === 'live' ? '真盘' : '模拟盘',
    price: result.price,
    reason: result.reason || undefined,
    ticket_id: result.ticketId,
  }
}

const ORDER_SCHEMA = {
  symbol: z.string().min(1).describe('股票代码，带交易所后缀，如 600519.SH / 300750.SZ'),
  side: z.enum(['buy', 'sell']).describe('buy=买入 sell=卖出'),
  qty: z.number().int().positive().describe('股数，必须是 100 的整数倍'),
} as const

export function createLumosTradeMcpServer(ctx: { sessionId: string }) {
  return createSdkMcpServer({
    name: LUMOS_TRADE_MCP_SERVER_NAME,
    tools: [
      tool(
        'preview_order',
        '预览一笔股票下单：返回现价、预估金额、手续费、是模拟盘还是真盘、确定性风控是否通过。下单前先调它，把结果说给用户听。只读，不下单。',
        ORDER_SCHEMA,
        async (args): Promise<CallToolResult> => {
          try {
            return json(await previewOrder(ctx.sessionId, args))
          } catch (error) {
            return err(error)
          }
        },
      ),
      tool(
        'place_order',
        '提交一笔股票下单（买/卖）。会先弹确认框等用户点确认，确认后过确定性风控总闸再下单（模拟盘本地撮合 / 真盘走券商）。下单前应先用 preview_order 让用户看清楚。',
        ORDER_SCHEMA,
        async (args): Promise<CallToolResult> => {
          try {
            return json(await submitOrder(ctx.sessionId, args))
          } catch (error) {
            return err(error)
          }
        },
      ),
    ],
  })
}

function json(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function err(error: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2) }],
    isError: true,
  }
}
