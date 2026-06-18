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
  return { liveBackend: jest.fn(), LiveBackendError, getLiveConfig: jest.fn(() => ({ liveEnabled: false, tradeMode: 'paper' })) }
})

import { placeOrder } from '../mesh-order-gateway'
import { initAccount, getAccount } from '../mesh-paper-account'
import { liveBackend, LiveBackendError } from '../mesh-live-backend'

const snapshot = { ticks: [{ code: '600160.SH', last: 45, pct: 5 }] }
const mockedLiveBackend = jest.mocked(liveBackend)

function stubLive(placeImpl: () => Promise<unknown>) {
  mockedLiveBackend.mockReturnValue({ placeOrder: placeImpl } as unknown as ReturnType<typeof liveBackend>)
}

beforeEach(() => mockedLiveBackend.mockReset())

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
})

describe('placeOrder (live) — M8 真盘后端', () => {
  it('live 未启用 → rejected，不碰后端（不 throw，绝不误下真单）', async () => {
    initAccount('L1', 100000)
    const r = await placeOrder('L1', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'L1-1', snapshot, mode: 'live' })
    expect(r.status).toBe('rejected')
    expect(r.reason).toContain('live 未启用')
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
    stubLive(async () => {
      throw new LiveBackendError('回执超时', 'timeout')
    })
    const r = await placeOrder('L4', { symbol: '600160.SH', side: 'buy', qty: 100 }, { idempotencyKey: 'L4-1', snapshot, mode: 'live', liveEnabled: true })
    expect(r.status).toBe('pending')
    expect(r.filled).toBe(false)
    expect(getAccount('L4')!.halted).toBe(true)
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
