/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})
// mock live 后端：验 gateway 逻辑，不真起子进程（真 IPC 由 mesh-live-backend.test 验）
jest.mock('../mesh-live-backend', () => {
  class LiveBackendError extends Error {
    constructor(
      message: string,
      public kind: string,
    ) {
      super(message)
      this.name = 'LiveBackendError'
    }
  }
  return {
    liveBackend: jest.fn(),
    LiveBackendError,
    getLiveConfig: jest.fn(() => ({ liveEnabled: false, tradeMode: 'paper', backendConfigured: false })),
    isLiveBackendConfigured: jest.fn(() => true),
  }
})
// mock 行情桥：验证"快照里没有该股价 → 下单时按需现取"这条新路径，不真起 python
jest.mock('../mesh-quote-feed', () => ({
  fetchTicksOnDemand: jest.fn(async () => []),
}))

import { placeOrder } from '../mesh-order-gateway'
import { initAccount, getAccount } from '../mesh-paper-account'
import { getTicket } from '../mesh-order-ticket'
import { isLiveBackendConfigured, liveBackend, LiveBackendError } from '../mesh-live-backend'
import { fetchTicksOnDemand } from '../mesh-quote-feed'

const snapshot = { ticks: [{ code: '600160.SH', last: 45, pct: 5 }] }
const mockedLiveBackend = jest.mocked(liveBackend)
const mockedIsLiveBackendConfigured = jest.mocked(isLiveBackendConfigured)
const mockedFetchTicks = jest.mocked(fetchTicksOnDemand)

function stubLive(placeImpl: () => Promise<unknown>) {
  mockedLiveBackend.mockReturnValue({ placeOrder: placeImpl } as unknown as ReturnType<typeof liveBackend>)
}

beforeEach(() => {
  mockedLiveBackend.mockReset()
  mockedIsLiveBackendConfigured.mockReturnValue(true)
  mockedFetchTicks.mockReset()
  mockedFetchTicks.mockResolvedValue([]) // 默认：按需取价取不到（除非用例显式 mock）
})

describe('placeOrder (paper)', () => {
  it('过 Risk Gate → paper 成交 + 账户记账 + ticket filled', async () => {
    initAccount('g1', 100000)
    const r = await placeOrder('g1', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'g1-1', snapshot })
    expect(r.filled).toBe(true)
    expect(r.status).toBe('filled')
    expect(r.price).toBe(45)
    const acc = getAccount('g1')!
    expect(acc.positions['600160.SH'].qty).toBe(100)
    expect(acc.cash).toBeLessThan(100000)
  })

  it('快照里没有该股 → 按需现取到价 → 正常成交（参考项目做法：下单就地取价，不限自选）', async () => {
    initAccount('od1', 100000)
    mockedFetchTicks.mockResolvedValue([{ code: '603011.SH', last: 32, pct: 3 }])
    const r = await placeOrder('od1', { symbol: '603011.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'od1-1', snapshot })
    expect(mockedFetchTicks).toHaveBeenCalledWith('od1', ['603011.SH'])
    expect(r.filled).toBe(true)
    expect(r.price).toBe(32)
    expect(getAccount('od1')!.positions['603011.SH'].qty).toBe(100)
  })

  it('快照无该股 + 按需也取不到价（mac/无 xtquant 降级）→ 拒单，绝不按假价下单', async () => {
    initAccount('od2', 100000)
    mockedFetchTicks.mockResolvedValue([])
    const r = await placeOrder('od2', { symbol: '603011.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'od2-1', snapshot })
    expect(r.status).toBe('rejected')
    expect(r.reason).toContain('有效行情')
    expect(getAccount('od2')!.positions['603011.SH']).toBeUndefined()
  })

  it('资金不足 → ticket rejected，账户不动', async () => {
    initAccount('g2', 100)
    const r = await placeOrder('g2', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'g2-1', snapshot })
    expect(r.filled).toBe(false)
    expect(r.status).toBe('rejected')
    expect(r.reason).toContain('资金不足')
    expect(getAccount('g2')!.cash).toBe(100)
  })

  it('幂等：同 key 不重复撮合（钱只扣一次）', async () => {
    initAccount('g3', 100000)
    const r1 = await placeOrder('g3', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'g3-1', snapshot })
    const cashAfter1 = getAccount('g3')!.cash
    const r2 = await placeOrder('g3', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'g3-1', snapshot })
    expect(r2.ticketId).toBe(r1.ticketId)
    expect(getAccount('g3')!.cash).toBe(cashAfter1)
  })

  it('M7 跨轮：不同 runId 同 accountId → 账户累积（常驻团队账户）', async () => {
    initAccount('acct-X', 100000)
    await placeOrder('run-1', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'run-1:k', snapshot, accountId: 'acct-X' })
    expect(getAccount('acct-X')!.positions['600160.SH'].qty).toBe(100)
    await placeOrder('run-2', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'run-2:k', snapshot, accountId: 'acct-X' })
    const acc = getAccount('acct-X')!
    expect(acc.positions['600160.SH'].qty).toBe(200)
    expect(acc.orderCount).toBe(2)
    expect(getAccount('run-1')).toBeNull()
  })

  it('paper 账户按需懒建：无账户直接下单 → 懒建账户再成交（修「中途加入下单成员/即时下单时账户没建」的边角）', async () => {
    expect(getAccount('g_lazy')).toBeNull() // 没预先 initAccount
    const r = await placeOrder('g_lazy', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'g_lazy-1', snapshot })
    expect(r.filled).toBe(true)
    expect(getAccount('g_lazy')?.positions['600160.SH'].qty).toBe(100)
  })
})

describe('placeOrder (live) — M8 真盘后端', () => {
  it('live 未启用 → rejected，不碰后端（不 throw，绝不误下真单）', async () => {
    initAccount('L1', 100000)
    const r = await placeOrder('L1', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'L1-1', snapshot, mode: 'live' })
    expect(r.status).toBe('rejected')
    expect(r.reason).toContain('live 未启用')
    expect(mockedLiveBackend).not.toHaveBeenCalled()
  })

  it('live 启用但后端未配置 → rejected，不回退到 mock 后端', async () => {
    initAccount('L0', 100000)
    mockedIsLiveBackendConfigured.mockReturnValue(false)
    const r = await placeOrder('L0', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'L0-1', snapshot, mode: 'live', liveEnabled: true })
    expect(r.status).toBe('rejected')
    expect(r.reason).toContain('live 后端脚本未配置')
    expect(mockedLiveBackend).not.toHaveBeenCalled()
  })

  it('live 启用 + 后端 filled → 成交记账（用后端回执价）', async () => {
    initAccount('L2', 100000)
    stubLive(async () => ({ status: 'filled', filledPrice: 44.8, filledQty: 100, brokerOrderId: 'B1' }))
    const r = await placeOrder('L2', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'L2-1', snapshot, mode: 'live', liveEnabled: true })
    expect(r.filled).toBe(true)
    expect(r.price).toBe(44.8)
    expect(getAccount('L2')!.positions['600160.SH'].qty).toBe(100)
  })

  it('live 后端拒单 → rejected，账户不动', async () => {
    initAccount('L3', 100000)
    stubLive(async () => ({ status: 'rejected', reason: '券商拒单' }))
    const r = await placeOrder('L3', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'L3-1', snapshot, mode: 'live', liveEnabled: true })
    expect(r.status).toBe('rejected')
    expect(r.reason).toContain('券商拒单')
    expect(getAccount('L3')!.positions['600160.SH']).toBeUndefined()
  })

  it('live 后端超时 → 自动 halt + ticket pending（绝不当成交、不盲目重下）', async () => {
    initAccount('L4', 100000)
    let calls = 0
    stubLive(async () => {
      calls += 1
      throw new LiveBackendError('回执超时', 'timeout')
    })
    const r = await placeOrder('L4', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'L4-1', snapshot, mode: 'live', liveEnabled: true })
    expect(r.status).toBe('pending')
    expect(r.filled).toBe(false)
    expect(r.reason).toContain('人工核对')
    expect(getTicket(r.ticketId)?.rejectReason).toContain('人工核对')
    expect(getAccount('L4')!.halted).toBe(true)

    const retry = await placeOrder('L4-retry', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'L4-1', snapshot, accountId: 'L4', mode: 'live', liveEnabled: true })
    expect(retry.status).toBe('pending')
    expect(retry.ticketId).toBe(r.ticketId)
    expect(calls).toBe(1)
    expect(getTicket(r.ticketId)?.status).toBe('pending')
  })

  it('live 后端 filled 回执数量超过原始下单数量 → pending + halt，不记账不重试', async () => {
    initAccount('L6', 100000)
    let calls = 0
    stubLive(async () => {
      calls += 1
      return { status: 'filled', filledPrice: 44.8, filledQty: 200, brokerOrderId: 'B2' }
    })
    const r = await placeOrder('L6', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'L6-1', snapshot, mode: 'live', liveEnabled: true })
    expect(r.status).toBe('pending')
    expect(r.reason).toContain('成交数量超过')
    expect(r.reason).toContain('人工核对')
    expect(getAccount('L6')!.halted).toBe(true)
    expect(getAccount('L6')!.positions['600160.SH']).toBeUndefined()

    const retry = await placeOrder('L6-retry', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'L6-1', snapshot, accountId: 'L6', mode: 'live', liveEnabled: true })
    expect(retry.status).toBe('pending')
    expect(calls).toBe(1)
  })

  it('live 后端 filled 回执缺有效成交价/量 → pending + halt，不用默认值伪造成交', async () => {
    initAccount('L7', 100000)
    stubLive(async () => ({ status: 'filled', brokerOrderId: 'B3' }))
    const r = await placeOrder('L7', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'L7-1', snapshot, mode: 'live', liveEnabled: true })
    expect(r.status).toBe('pending')
    expect(r.reason).toContain('有效成交价')
    expect(getAccount('L7')!.halted).toBe(true)
    expect(getAccount('L7')!.positions['600160.SH']).toBeUndefined()
  })

  it('live 后端 filled 回执价格高于请求限价 → pending + halt，不按超价成交记账', async () => {
    initAccount('L8', 100000)
    stubLive(async () => ({ status: 'filled', filledPrice: 46, filledQty: 100, brokerOrderId: 'B4' }))
    const r = await placeOrder('L8', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'L8-1', snapshot, mode: 'live', liveEnabled: true })
    expect(r.status).toBe('pending')
    expect(r.reason).toContain('高于请求限价')
    expect(getAccount('L8')!.halted).toBe(true)
    expect(getAccount('L8')!.positions['600160.SH']).toBeUndefined()
  })

  it('live 后端崩溃 → 自动 halt（in-flight 不当成交）', async () => {
    initAccount('L5', 100000)
    stubLive(async () => {
      throw new LiveBackendError('子进程退出', 'crash')
    })
    const r = await placeOrder('L5', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'L5-1', snapshot, mode: 'live', liveEnabled: true })
    expect(r.filled).toBe(false)
    expect(getAccount('L5')!.halted).toBe(true)
  })
})
