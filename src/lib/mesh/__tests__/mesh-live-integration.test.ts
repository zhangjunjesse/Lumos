/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock 工厂内须用 require：顶部 import 会被 hoist 到 factory 之前导致 TDZ */
jest.mock('@/lib/db/connection', () => {
  const Database = require('better-sqlite3')
  const { migrateMeshTables } = require('@/lib/db/migrations-mesh')
  const mem = new Database(':memory:')
  migrateMeshTables(mem)
  return { getDb: () => mem }
})

import path from 'path'
import { placeOrder } from '../mesh-order-gateway'
import { initAccount, getAccount } from '../mesh-paper-account'
import { liveBackend } from '../mesh-live-backend'

// L2-mock：不 mock live 后端，真起 mock_trade_backend.py 子进程，走完整 placeOrder→IPC→记账链路。
const SCRIPT = path.resolve(__dirname, '../../../../resources/mcp-servers/mesh-trade/mock_trade_backend.py')
const snapshot = { ticks: [{ code: '600160.SH', last: 45, pct: 5 }] }

describe('M8 L2-mock 端到端：placeOrder live → 真 mock python 子进程 → 记账', () => {
  beforeAll(() => {
    process.env.LUMOS_MESH_LIVE_BACKEND = SCRIPT
  })
  afterAll(() => {
    liveBackend().shutdown()
    delete process.env.LUMOS_MESH_LIVE_BACKEND
  })

  it('live 下单经真子进程成交 + 账户记账 + ticket filled', async () => {
    initAccount('e2e', 100000)
    const r = await placeOrder(
      'e2e',
      { symbol: '600160.SH', side: 'buy', qty: 100 },
      { idempotencyKey: 'e2e-1', snapshot, mode: 'live', liveEnabled: true },
    )
    expect(r.status).toBe('filled')
    expect(r.filled).toBe(true)
    expect(r.price).toBe(45) // mock 回请求价（= verdict.price）
    const acc = getAccount('e2e')!
    expect(acc.positions['600160.SH'].qty).toBe(100)
    expect(acc.cash).toBeLessThan(100000)
  })

  it('幂等：同 key 重复 live 下单，钱只扣一次（防重复下单）', async () => {
    initAccount('e2e2', 100000)
    const r1 = await placeOrder(
      'e2e2',
      { symbol: '600160.SH', side: 'buy', qty: 100 },
      { idempotencyKey: 'e2e2-1', snapshot, mode: 'live', liveEnabled: true },
    )
    const cash1 = getAccount('e2e2')!.cash
    const r2 = await placeOrder(
      'e2e2',
      { symbol: '600160.SH', side: 'buy', qty: 100 },
      { idempotencyKey: 'e2e2-1', snapshot, mode: 'live', liveEnabled: true },
    )
    expect(r2.ticketId).toBe(r1.ticketId)
    expect(getAccount('e2e2')!.cash).toBe(cash1)
  })

  it('真子进程崩溃 → 自动 halt（in-flight 不当成交）', async () => {
    liveBackend().shutdown() // 弃掉 normal 子进程
    process.env.MESH_MOCK_MODE = 'crash' // 重 spawn 时按 crash 模式（收到下单即退出）
    initAccount('e2e3', 100000)
    const r = await placeOrder(
      'e2e3',
      { symbol: '600160.SH', side: 'buy', qty: 100 },
      { idempotencyKey: 'e2e3-1', snapshot, mode: 'live', liveEnabled: true },
    )
    expect(r.filled).toBe(false)
    expect(getAccount('e2e3')!.halted).toBe(true) // 子进程崩溃 → 自动总闸 halt
    expect(getAccount('e2e3')!.positions['600160.SH']).toBeUndefined() // 没记成成交
    delete process.env.MESH_MOCK_MODE
  })
})
