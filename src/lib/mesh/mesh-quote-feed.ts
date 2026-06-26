/**
 * 真行情喂入桥（去假数据）—— 常驻 spawn qmt_quote_feed.py，按需取真实 tick 进缓存。
 *
 * 替代写死的 DEFAULT_SNAPSHOT：RiskGate 下单校验 + 盯盘 agent 都从这里拿价。
 * watchlist = 账户当前持仓（用户选「先只持仓」）。
 *
 * 安全/降级：mac 或没装 xtquant → spawn 的 python 启动即退出 → 永不 ready → getSnapshot 返回空
 * {ticks:[]}（**绝不喂假数据**；RiskGate 据此对无行情的标的拒单，符合"宁可不交易也不按假价下单"）。
 *
 * qmt 真路径只能 Windows L2 验；mac 上恒走空回退（本文件逻辑可在 mac 验"降级为空、不假"）。
 */
import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import { resolvePythonBinary } from '@/lib/python-runtime'
import { resolveRuntimeResourcePath } from '@/lib/runtime-resources'
import { writeBlackboard, MARKET_SNAPSHOT_KEY } from './mesh-blackboard'
import { getAccount } from './mesh-paper-account'
import { getTeamConfig } from './mesh-team-config'

export interface QuoteTick {
  code: string
  last: number
  pct: number | null
}
export interface QuoteSnapshot {
  ticks: QuoteTick[]
}

const REFRESH_MS = 5_000 // 行情刷新间隔；每轮刷新黑板快照,RiskGate 拿到的是最新价而非开盘价
const REQUEST_TIMEOUT_MS = 8_000
const SPAWN_BACKOFF_MS = 30_000 // python 起不来(mac/没装 xtquant)→ 冷却,免每 5s 反复 spawn 秒退

/** 单个账户的行情桥:管 python 子进程 + 最新快照缓存 + 刷新定时器。 */
class QuoteFeed {
  private child: ChildProcess | null = null
  private buf = ''
  private ready = false
  private seq = 0
  private pending = new Map<string, { resolve: (t: QuoteTick[]) => void; timer: ReturnType<typeof setTimeout> }>()
  private cache: QuoteTick[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private lastSpawnFailAt = 0 // 上次"起来即退"的时刻,用于退避
  private lastWrittenJson = '' // 上次写进黑板的快照,行情没变就不重复写(免版本号狂涨)

  constructor(private accountId: string, private runId: string) {}

  start(): void {
    this.scheduleRefresh(0)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.failAll()
    const c = this.child
    this.child = null
    if (c) {
      c.stdout?.removeAllListeners()
      c.stdout?.destroy()
      c.stdin?.destroy()
      c.removeAllListeners()
      c.kill()
    }
  }

  /** 最新快照(同步,供 runner.snapshot() + RiskGate)。无行情=空,绝不假。 */
  snapshot(): QuoteSnapshot {
    return { ticks: this.cache }
  }

  private scheduleRefresh(delay: number): void {
    if (this.stopped) return
    this.timer = setTimeout(() => void this.refresh(), delay)
  }

  private async refresh(): Promise<void> {
    if (this.stopped) return
    try {
      const codes = this.codesToFetch()
      this.cache = codes.length ? await this.getTicks(codes) : []
      // 只在行情变化时写黑板(RiskGate 读这里):免版本号狂涨 + 无谓 DB 写;停了就别再写。
      if (!this.stopped) {
        const json = JSON.stringify({ ticks: this.cache })
        if (json !== this.lastWrittenJson) {
          writeBlackboard(this.runId, MARKET_SNAPSHOT_KEY, { ticks: this.cache }, 'quote_feed')
          this.lastWrittenJson = json
        }
      }
    } catch {
      this.cache = [] // 取不到→空,不留旧/假价
    }
    this.scheduleRefresh(REFRESH_MS)
  }

  /** 取价范围 = 持仓 + 自选股(去重)。买新股要先进自选,否则 RiskGate 因无价拒单。 */
  private codesToFetch(): string[] {
    const account = getAccount(this.accountId)
    const held = account ? Object.keys(account.positions) : []
    const watch = getTeamConfig(this.accountId).watchlist
    return Array.from(new Set([...held, ...watch]))
  }

  private getTicks(codes: string[]): Promise<QuoteTick[]> {
    try {
      this.ensureChild()
    } catch {
      return Promise.resolve([]) // python/脚本不可用(mac)→空
    }
    if (!this.ready) return Promise.resolve([]) // 还没握手(或起不来)→空,不阻塞
    const id = `q${++this.seq}`
    return new Promise<QuoteTick[]>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve([])
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, timer })
      this.child?.stdin?.write(JSON.stringify({ id, method: 'get_ticks', params: { codes } }) + '\n')
    })
  }

  /** 按需现取某些股的实时 tick（不限自选/持仓）；复用同一子进程通道。无桥/取不到→[]。 */
  fetchNow(codes: string[]): Promise<QuoteTick[]> {
    return this.getTicks(codes)
  }

  private ensureChild(): void {
    if (this.child && !this.child.killed) return
    if (Date.now() - this.lastSpawnFailAt < SPAWN_BACKOFF_MS) throw new Error('quote feed 退避中(上次起即退)')
    const python = resolvePythonBinary({ minimumVersion: { major: 3, minor: 8 } })
    const script = resolveRuntimeResourcePath(path.join('mcp-servers', 'mesh-trade', 'qmt_quote_feed.py'))
    if (!python || !script) throw new Error('quote feed 不可用(python/脚本缺)')
    const child = spawn(python, [script], { stdio: ['pipe', 'pipe', 'pipe'] })
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
    let msg: { type?: string; id?: string; result?: { ticks?: QuoteTick[] } }
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    if (msg.type === 'ready') {
      this.ready = true
      return
    }
    if (!msg.id) return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    clearTimeout(p.timer)
    p.resolve(Array.isArray(msg.result?.ticks) ? msg.result!.ticks! : [])
  }

  private onExit(): void {
    if (!this.ready) this.lastSpawnFailAt = Date.now() // 没握手就退(mac/没 xtquant)→ 触发退避
    this.child = null
    this.ready = false
    this.failAll()
  }

  private failAll(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.resolve([])
    }
    this.pending.clear()
  }
}

const feeds = new Map<string, QuoteFeed>()

/** 启动某账户的行情桥(随 run 启动)。 */
export function startQuoteFeed(accountId: string, runId: string): void {
  stopQuoteFeed(accountId)
  const feed = new QuoteFeed(accountId, runId)
  feeds.set(accountId, feed)
  feed.start()
}

/** 确保某账户有行情桥在跑（聊天下单等无 run 场景懒启用）；已有则不动，不会顶掉团队正在跑的桥。 */
export function ensureQuoteFeed(accountId: string, runId: string): void {
  if (!feeds.has(accountId)) startQuoteFeed(accountId, runId)
}

/** 停止某账户的行情桥(随 run 停止)。 */
export function stopQuoteFeed(accountId: string): void {
  const feed = feeds.get(accountId)
  if (feed) {
    feed.stop()
    feeds.delete(accountId)
  }
}

/** 取某账户最新真实行情快照(同步)。无桥/无行情=空 {ticks:[]},绝不返回假数据。 */
export function getQuoteSnapshot(accountId: string): QuoteSnapshot {
  return feeds.get(accountId)?.snapshot() ?? { ticks: [] }
}

/**
 * 下单前按需现取某些股的实时 tick（不限当前持仓/自选）。
 * 参考成熟交易实现的做法：下单时就地取价，而非依赖只覆盖自选的缓存快照——
 * 否则买一只不在自选里的股，RiskGate 会因"无该标的有效行情"误拒（price=0）。
 * 无活跃行情桥 / mac 无 xtquant / 取不到 → 返回 []（RiskGate 据此拒单，绝不按假价下单）。
 */
export async function fetchTicksOnDemand(accountId: string, codes: string[]): Promise<QuoteTick[]> {
  const feed = feeds.get(accountId)
  if (!feed || codes.length === 0) return []
  return feed.fetchNow(codes)
}
