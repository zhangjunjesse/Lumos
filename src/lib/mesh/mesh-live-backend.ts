/**
 * OrderGateway live 后端 IPC 客户端 —— Node 起 Python 子进程，JSON-RPC over stdio 下单。
 * Windows 上 Python 接国金 qmt 真下单；mac 用 mock_trade_backend.py 验链路。
 * 真钱安全：超时不当成交(抛 timeout 交上层 halt)、子进程崩溃 in-flight 全 reject、幂等键透传。
 * 协议见 docs/mesh-live-backend-protocol.md。自有子进程，不碰 workflow。
 */
import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import path from 'path'
import { resolvePythonBinary } from '@/lib/python-runtime'
import { resolveRuntimeResourcePath } from '@/lib/runtime-resources'

export interface LivePlaceParams {
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  price: number
  idempotencyKey: string
}

export interface LivePlaceResult {
  status: 'filled' | 'rejected'
  filledPrice?: number
  filledQty?: number
  brokerOrderId?: string
  reason?: string
}

export type LiveBackendErrorKind = 'timeout' | 'crash' | 'spawn' | 'protocol'

/** kind 用于上层区分处置：timeout/crash → 自动 halt；protocol → 拒单。 */
export class LiveBackendError extends Error {
  constructor(
    message: string,
    readonly kind: LiveBackendErrorKind,
  ) {
    super(message)
    this.name = 'LiveBackendError'
  }
}

interface Pending {
  resolve: (r: LivePlaceResult) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface BackendOptions {
  script?: string
  env?: Record<string, string>
  requestTimeoutMs?: number
  handshakeTimeoutMs?: number
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 8_000

export class LiveBackend {
  private child: ChildProcess | null = null
  private pending = new Map<string, Pending>()
  private buf = ''
  private ready = false
  private readyWaiters: Array<(ok: boolean) => void> = []

  constructor(private opts: BackendOptions = {}) {}

  private backendScript(): string {
    if (this.opts.script) return this.opts.script
    if (process.env.LUMOS_MESH_LIVE_BACKEND) return process.env.LUMOS_MESH_LIVE_BACKEND
    return resolveRuntimeResourcePath(path.join('mcp-servers', 'mesh-trade', 'mock_trade_backend.py')) ?? ''
  }

  private ensureChild(): void {
    if (this.child && !this.child.killed) return
    const python = resolvePythonBinary({ minimumVersion: { major: 3, minor: 8 } })
    if (!python) throw new LiveBackendError('python runtime 不可用', 'spawn')
    const script = this.backendScript()
    if (!script) throw new LiveBackendError('live backend 脚本未配置', 'spawn')
    const child = spawn(python, [script], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.opts.env },
    })
    this.child = child
    this.ready = false
    this.buf = ''
    child.stdout?.on('data', (d: Buffer) => this.onData(d.toString()))
    child.on('exit', () => this.onExit())
    child.on('error', () => this.onExit())
  }

  private onData(chunk: string): void {
    this.buf += chunk
    let idx: number
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      if (line) this.onMessage(line)
    }
  }

  private onMessage(line: string): void {
    let msg: { type?: string; id?: string; result?: LivePlaceResult; error?: { message?: string } }
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.type === 'ready') {
      this.ready = true
      this.readyWaiters.forEach((w) => w(true))
      this.readyWaiters = []
      return
    }
    if (!msg.id) return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.error) p.reject(new LiveBackendError(msg.error.message ?? 'backend error', 'protocol'))
    else if (msg.result) p.resolve(msg.result)
    else p.reject(new LiveBackendError('回执缺 result', 'protocol'))
  }

  private failPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
    this.readyWaiters.forEach((w) => w(false))
    this.readyWaiters = []
  }

  // 释放子进程 stdio handle + listener，避免泄漏（测试里会被 jest 当 open handle）。
  private cleanupChild(): void {
    const c = this.child
    this.child = null
    this.ready = false
    if (c) {
      c.stdout?.removeAllListeners()
      c.stdout?.destroy()
      c.stdin?.destroy()
      c.removeAllListeners()
    }
  }

  private onExit(): void {
    this.cleanupChild()
    this.failPending(new LiveBackendError('live backend 子进程退出', 'crash'))
  }

  private async waitReady(): Promise<void> {
    if (this.ready) return
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const t = setTimeout(() => {
        if (settled) return
        settled = true
        const err = new LiveBackendError('握手超时', 'timeout')
        const child = this.child
        if (child) child.kill()
        this.cleanupChild()
        this.failPending(err) // failPending 会清空 readyWaiters（含本 waiter）
        reject(err)
      }, this.opts.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS)
      const waiter = (ok: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(t)
        this.readyWaiters = this.readyWaiters.filter((w) => w !== waiter)
        if (ok) resolve()
        else reject(new LiveBackendError('子进程启动即退出', 'crash'))
      }
      this.readyWaiters.push(waiter)
    })
  }

  isConnected(): boolean {
    return Boolean(this.child) && this.ready
  }

  async placeOrder(params: LivePlaceParams): Promise<LivePlaceResult> {
    this.ensureChild()
    await this.waitReady()
    const id = randomUUID()
    return new Promise<LivePlaceResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new LiveBackendError('下单回执超时（不可当成交，需人工核对）', 'timeout'))
      }, this.opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      const child = this.child
      if (!child || !child.stdin) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new LiveBackendError('子进程 stdin 不可用', 'crash'))
        return
      }
      child.stdin.write(JSON.stringify({ id, method: 'place_order', params }) + '\n')
    })
  }

  shutdown(): void {
    if (this.child) this.child.kill()
    this.cleanupChild()
    this.failPending(new LiveBackendError('live backend 已关闭', 'crash'))
  }
}

export interface LiveConfig {
  liveEnabled: boolean
  tradeMode: 'paper' | 'live'
  backendConfigured: boolean
}

export function isLiveBackendConfigured(): boolean {
  return Boolean(process.env.LUMOS_MESH_LIVE_BACKEND?.trim())
}

/** 真盘开关从 env 读（部署级，不入 db/UI——真钱保险）。liveEnabled 关时 tradeMode 强制 paper。 */
export function getLiveConfig(): LiveConfig {
  const liveEnabled = process.env.LUMOS_MESH_ENABLE_LIVE === '1'
  const backendConfigured = isLiveBackendConfigured()
  const tradeMode: 'paper' | 'live' =
    liveEnabled && backendConfigured && process.env.LUMOS_MESH_TRADE_MODE === 'live' ? 'live' : 'paper'
  return { liveEnabled, tradeMode, backendConfigured }
}

// 进程级单例（生产用）；测试可 new LiveBackend({script,env}) 起独立实例。
const g = globalThis as unknown as { __meshLiveBackend?: LiveBackend }
export function liveBackend(): LiveBackend {
  if (!g.__meshLiveBackend) g.__meshLiveBackend = new LiveBackend()
  return g.__meshLiveBackend
}
