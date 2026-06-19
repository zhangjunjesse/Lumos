import path from 'path'
import { LiveBackend, LiveBackendError } from '../mesh-live-backend'

// 真起 mock_trade_backend.py 子进程（非 mock，验真实 IPC 链路）
const SCRIPT = path.resolve(__dirname, '../../../../resources/mcp-servers/mesh-trade/mock_trade_backend.py')

function backend(mode: string) {
  return new LiveBackend({
    script: SCRIPT,
    env: { MESH_MOCK_MODE: mode },
    requestTimeoutMs: 2000,
    handshakeTimeoutMs: 5000,
  })
}

describe('mesh-live-backend IPC（真起 mock python 子进程）', () => {
  it('normal → filled 回执，价/量/幂等键透传', async () => {
    const b = backend('normal')
    try {
      const r = await b.placeOrder({ symbol: '600160.SH', side: 'buy', qty: 100, price: 45.2, idempotencyKey: 'k1' })
      expect(r.status).toBe('filled')
      expect(r.filledPrice).toBe(45.2)
      expect(r.filledQty).toBe(100)
      expect(r.brokerOrderId).toMatch(/^MOCK-/)
      expect(b.isConnected()).toBe(true)
    } finally {
      b.shutdown()
    }
  })

  it('reject → rejected 回执', async () => {
    const b = backend('reject')
    try {
      const r = await b.placeOrder({ symbol: 'X', side: 'buy', qty: 100, price: 10, idempotencyKey: 'k2' })
      expect(r.status).toBe('rejected')
      expect(r.reason).toContain('mock reject')
    } finally {
      b.shutdown()
    }
  })

  it('timeout → 抛 LiveBackendError(timeout)，绝不当成交', async () => {
    const b = backend('timeout')
    try {
      await expect(
        b.placeOrder({ symbol: 'X', side: 'buy', qty: 100, price: 10, idempotencyKey: 'k3' }),
      ).rejects.toMatchObject({ kind: 'timeout' })
    } finally {
      b.shutdown()
    }
  })

  it('handshake timeout → 清理卡死子进程，下一次可重新启动', async () => {
    process.env.MESH_MOCK_MODE = 'no_ready'
    const b = new LiveBackend({ script: SCRIPT, requestTimeoutMs: 1000, handshakeTimeoutMs: 300 })
    try {
      await expect(
        b.placeOrder({ symbol: 'X', side: 'buy', qty: 100, price: 10, idempotencyKey: 'k-ready-timeout-1' }),
      ).rejects.toMatchObject({ kind: 'timeout' })
      expect(b.isConnected()).toBe(false)
      process.env.MESH_MOCK_MODE = 'normal'
      const r = await b.placeOrder({
        symbol: 'X',
        side: 'buy',
        qty: 100,
        price: 10,
        idempotencyKey: 'k-ready-timeout-2',
      })
      expect(r.status).toBe('filled')
      expect(b.isConnected()).toBe(true)
    } finally {
      delete process.env.MESH_MOCK_MODE
      b.shutdown()
    }
  })

  it('crash → 抛 LiveBackendError(crash)，in-flight 不当成交', async () => {
    const b = backend('crash')
    try {
      const err = await b.placeOrder({ symbol: 'X', side: 'buy', qty: 100, price: 10, idempotencyKey: 'k4' }).catch((e) => e)
      expect(err).toBeInstanceOf(LiveBackendError)
      expect((err as LiveBackendError).kind).toBe('crash')
    } finally {
      b.shutdown()
    }
  })

  it('shutdown 后 isConnected=false', async () => {
    const b = backend('normal')
    await b.placeOrder({ symbol: 'X', side: 'buy', qty: 1, price: 1, idempotencyKey: 'k5' })
    b.shutdown()
    expect(b.isConnected()).toBe(false)
  })
})
