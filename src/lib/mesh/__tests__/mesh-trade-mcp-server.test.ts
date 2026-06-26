/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})
jest.mock('../mesh-order-gateway', () => ({ placeOrder: jest.fn() }))
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (cfg: { name: string; tools: unknown[] }) => cfg,
  tool: (name: string, _desc: string, _schema: unknown, handler: unknown) => ({ name, handler }),
}))

import { createMeshTradeMcpServer, type MeshTradeToolContext } from '../mesh-trade-mcp-server'
import { placeOrder } from '../mesh-order-gateway'
import { readBlackboard, writeBlackboard, MARKET_SNAPSHOT_KEY } from '../mesh-blackboard'
import type { TradeContext } from '../mesh-runtime'

const mockedPlace = jest.mocked(placeOrder)
const autoTrade: TradeContext = { mode: 'auto', accountId: 'acc', tradeMode: 'paper', liveEnabled: false }

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>
function placeOrderTool(ctx: MeshTradeToolContext): Handler {
  const server = createMeshTradeMcpServer(ctx) as unknown as { tools: Array<{ name: string; handler: Handler }> }
  return server.tools.find((t) => t.name === 'place_order')!.handler
}
async function call(handler: Handler, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await handler(args)
  return JSON.parse(res.content[0].text)
}

beforeEach(() => mockedPlace.mockReset())

describe('mesh-trade —— place_order 工具(经确定性风控总闸 + OrderGateway)', () => {
  it('observe_only：只记录意图、绝不调 OrderGateway', async () => {
    const handler = placeOrderTool({ runId: 'rt1', agentId: 'risk', cycleSeq: 1, trade: { ...autoTrade, mode: 'observe_only' } })
    const out = await call(handler, { symbol: '600519.SH', side: 'buy', qty: 100 })
    expect(out.status).toBe('skipped')
    expect(mockedPlace).not.toHaveBeenCalled()
    expect(readBlackboard('rt1', 'order_result:600519.SH')?.value).toMatchObject({ status: 'skipped' })
  })

  it('auto：调 placeOrder(稳定幂等键 + 当前快照 + 账户/风控),成交回写白板', async () => {
    mockedPlace.mockResolvedValue({ ticketId: 't', status: 'filled', filled: true, reason: '', price: 63.5 })
    writeBlackboard('rt2', MARKET_SNAPSHOT_KEY, { ticks: [{ code: '600519.SH', last: 63.5 }] }, 'seed')
    const handler = placeOrderTool({ runId: 'rt2', agentId: 'risk', cycleSeq: 7, trade: { ...autoTrade, accountId: 'acc2' } })
    const out = await call(handler, { symbol: '600519.SH', side: 'buy', qty: 100 })
    expect(out).toMatchObject({ ok: true, status: 'filled', price: 63.5 })
    expect(mockedPlace).toHaveBeenCalledTimes(1)
    const [runId, intent, opts] = mockedPlace.mock.calls[0]
    expect(runId).toBe('rt2')
    expect(intent).toEqual({ symbol: '600519.SH', side: 'buy', qty: 100 })
    expect(opts.idempotencyKey).toBe('rt2:risk:7:600519.SH:buy:100') // 稳定键,不含 Date.now()
    expect(opts.accountId).toBe('acc2')
    expect(opts.snapshot).toEqual({ ticks: [{ code: '600519.SH', last: 63.5 }] }) // 就地读当前快照
    expect(readBlackboard('rt2', 'order_result:600519.SH')?.value).toMatchObject({ status: 'filled', price: 63.5 })
  })

  it('幂等键随 cycleSeq 变：常驻 runId 跨轮不撞(新单不被吞)', async () => {
    mockedPlace.mockResolvedValue({ ticketId: 't', status: 'filled', filled: true, reason: '', price: 10 })
    await call(placeOrderTool({ runId: 'rt3', agentId: 'risk', cycleSeq: 1, trade: autoTrade }), { symbol: 'X.SH', side: 'buy', qty: 100 })
    await call(placeOrderTool({ runId: 'rt3', agentId: 'risk', cycleSeq: 2, trade: autoTrade }), { symbol: 'X.SH', side: 'buy', qty: 100 })
    const keys = mockedPlace.mock.calls.map((c) => c[2].idempotencyKey)
    expect(keys).toEqual(['rt3:risk:1:X.SH:buy:100', 'rt3:risk:2:X.SH:buy:100'])
  })

  it('OrderGateway 抛错(如总闸 halt)：返回 ok:false + error，不崩', async () => {
    mockedPlace.mockRejectedValue(new Error('halt: 单日亏损触线'))
    const out = await call(placeOrderTool({ runId: 'rt4', agentId: 'risk', cycleSeq: 1, trade: autoTrade }), { symbol: 'Y.SH', side: 'sell', qty: 200 })
    expect(out.ok).toBe(false)
    expect(out.error).toContain('halt')
  })
})
