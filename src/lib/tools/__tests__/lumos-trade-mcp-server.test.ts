const settings: Record<string, string> = {}
const calls: { placeOrder: unknown[][] } = { placeOrder: [] }
const stubs = {
  tradeMode: 'paper' as 'paper' | 'live',
  liveEnabled: false,
  snapshotTicks: [] as Array<{ code: string; last: number; pct: number | null }>,
  freshTicks: [] as Array<{ code: string; last: number; pct: number | null }>,
  placeResult: {} as Record<string, unknown>,
}

// SDK 是 ESM，jest 直接 import 会炸；测试只用 previewOrder/submitOrder（不碰 createSdkMcpServer/tool），stub 掉即可。
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({ createSdkMcpServer: () => ({}), tool: () => ({}) }))
jest.mock('@/lib/db', () => ({ getSetting: (k: string) => settings[k] || '' }))
jest.mock('@/lib/mesh/mesh-order-gateway', () => ({
  placeOrder: async (...a: unknown[]) => {
    calls.placeOrder.push(a)
    return stubs.placeResult
  },
}))
jest.mock('@/lib/mesh/mesh-session-context', () => ({
  buildTradeContext: () => ({
    mode: 'auto',
    rules: { maxSingleNotional: 1e9, maxTotalNotional: 1e9, maxDailyLoss: 1e9, maxOrdersPerDay: 999, noChaseLimitUp: false, blacklist: [] },
    accountId: 'mesh_team_default',
    tradeMode: stubs.tradeMode,
    liveEnabled: stubs.liveEnabled,
  }),
}))
jest.mock('@/lib/mesh/mesh-paper-account', () => ({
  getAccount: () => ({ cash: 1e6, positions: {}, orderCount: 0, halted: false, dailyRealizedPnl: 0 }),
  initAccount: () => ({}),
}))
jest.mock('@/lib/mesh/mesh-quote-feed', () => ({
  ensureQuoteFeed: () => {},
  getQuoteSnapshot: () => ({ ticks: stubs.snapshotTicks }),
  fetchTicksOnDemand: async () => stubs.freshTicks,
}))

import { submitOrder, previewOrder } from '../lumos-trade-mcp-server'

beforeEach(() => {
  for (const k of Object.keys(settings)) delete settings[k]
  calls.placeOrder = []
  stubs.tradeMode = 'paper'
  stubs.liveEnabled = false
  stubs.snapshotTicks = []
  stubs.freshTicks = []
  stubs.placeResult = { filled: true, status: 'filled', price: 32, reason: '', ticketId: 't1' }
})

describe('lumos-trade place_order（真钱安全）', () => {
  it('开了「跳过权限」→ 直接拒，不调 OrderGateway（绝不无确认下单）', async () => {
    settings['dangerously_skip_permissions'] = 'true'
    const r = await submitOrder('s1', { symbol: '600519.SH', side: 'buy', qty: 100 })
    expect(r.ok).toBe(false)
    expect(String(r.reason)).toContain('跳过权限')
    expect(calls.placeOrder).toHaveLength(0)
  })

  it('正常(paper)→ 以 paper 模式、默认工作室账户调 OrderGateway', async () => {
    const r = await submitOrder('s2', { symbol: '600519.SH', side: 'buy', qty: 100 })
    expect(calls.placeOrder).toHaveLength(1)
    const opts = calls.placeOrder[0][2] as Record<string, unknown>
    expect(opts.mode).toBe('paper')
    expect(opts.accountId).toBe('mesh_team_default')
    expect(opts.liveEnabled).toBe(false)
    expect(r.ok).toBe(true)
    expect(r.mode).toBe('模拟盘')
    expect(r.price).toBe(32)
  })

  it('真盘开关开 → 以 live 模式 + liveEnabled 透传给 OrderGateway', async () => {
    stubs.tradeMode = 'live'
    stubs.liveEnabled = true
    const r = await submitOrder('s3', { symbol: '600519.SH', side: 'buy', qty: 100 })
    const opts = calls.placeOrder[0][2] as Record<string, unknown>
    expect(opts.mode).toBe('live')
    expect(opts.liveEnabled).toBe(true)
    expect(r.mode).toBe('真盘')
  })
})

describe('lumos-trade preview_order', () => {
  it('拿不到实时价 → ok:false（不按假价预览/下单）', async () => {
    stubs.snapshotTicks = []
    stubs.freshTicks = []
    const r = await previewOrder('s4', { symbol: '603011.SH', side: 'buy', qty: 100 })
    expect(r.ok).toBe(false)
    expect(String(r.reason)).toContain('拿不到')
  })

  it('有现价 → 返回现价/预估金额/模拟盘', async () => {
    stubs.freshTicks = [{ code: '603011.SH', last: 32, pct: null }]
    const r = await previewOrder('s5', { symbol: '603011.SH', side: 'buy', qty: 100 })
    expect(r.ok).toBe(true)
    expect(r.price).toBe(32)
    expect(r.estimated_amount).toBe(3200)
    expect(r.mode).toBe('模拟盘')
  })
})
