/**
 * mesh-trade —— 下单能力,做成 agent 可调的「危险」MCP 工具(in-process)。
 *
 * 取代旧的 action-plan `order_intent` 路由:有下单职责的 agent(其 mcpAllowlist 含 'mesh-trade')
 * 在 turn 内调 place_order,经**确定性风控总闸 + OrderGateway**(唯一持撮合权)执行——复用现成、
 * 已验证的下单链,不碰 OrderGateway 本身。下单安全靠"结构隔离 + 确定性护栏",不靠工具白名单。
 *
 * 每个 duty cycle 现建一次(带 runId/agentId/cycleSeq/tradeCtx)。
 * 自治团队无人逐单确认,护栏=确定性 RiskGate 总闸(限额可配);observe_only 模式只记录不下单。
 * 幂等键 = runId:agent:cycleSeq:symbol:side:qty(稳定,重试自动去重;不用 Date.now)。
 */
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { placeOrder } from './mesh-order-gateway'
import { writeBlackboard, readBlackboard, MARKET_SNAPSHOT_KEY } from './mesh-blackboard'
import { MESH_TRADE_MCP_SERVER_NAME } from './mesh-constants'
import type { TradeContext } from './mesh-runtime'

export interface MeshTradeToolContext {
  runId: string
  agentId: string
  cycleSeq: number
  trade: TradeContext
}

interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export function createMeshTradeMcpServer(ctx: MeshTradeToolContext) {
  return createSdkMcpServer({
    name: MESH_TRADE_MCP_SERVER_NAME,
    tools: [
      tool(
        'place_order',
        '提交一笔股票下单(买/卖)。经确定性风控总闸(单日亏损/笔数/金额等,限额可配)+ OrderGateway 撮合(模拟盘/真盘)。observe_only 模式下只记录意图、不真下单。股数应为 100 整数倍。',
        {
          symbol: z.string().min(1).describe('股票代码,带交易所后缀,如 600519.SH'),
          side: z.enum(['buy', 'sell']).describe('buy=买入 sell=卖出'),
          qty: z.number().int().positive().describe('股数,100 的整数倍'),
        },
        async (args): Promise<CallToolResult> => {
          try {
            if (ctx.trade.mode === 'observe_only') {
              writeBlackboard(ctx.runId, `order_result:${args.symbol}`, { intent: args, status: 'skipped', reason: 'observe_only(只看不买)' }, ctx.agentId)
              return json({ ok: false, status: 'skipped', reason: 'observe_only(只看不买)' })
            }
            const snapshot = readBlackboard(ctx.runId, MARKET_SNAPSHOT_KEY)?.value
            const result = await placeOrder(
              ctx.runId,
              { symbol: args.symbol, side: args.side, qty: args.qty },
              {
                idempotencyKey: `${ctx.runId}:${ctx.agentId}:${ctx.cycleSeq}:${args.symbol}:${args.side}:${args.qty}`,
                snapshot,
                rules: ctx.trade.rules,
                accountId: ctx.trade.accountId,
                mode: ctx.trade.tradeMode,
                liveEnabled: ctx.trade.liveEnabled,
              },
            )
            writeBlackboard(ctx.runId, `order_result:${args.symbol}`, { intent: args, ...result }, ctx.agentId)
            return json({ ok: result.filled, status: result.status, mode: ctx.trade.tradeMode, price: result.price, reason: result.reason || undefined })
          } catch (error) {
            return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, true)
          }
        },
      ),
    ],
  })
}

function json(data: unknown, isError = false): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], ...(isError ? { isError: true } : {}) }
}
