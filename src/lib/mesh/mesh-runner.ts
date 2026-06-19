/**
 * 常驻 session runner —— 一次 start→stop 一个常驻 runId，时间轮调度每 agent 各自 duty loop。
 * 内存注册表（globalThis）持 scheduler 调度态 + 关联 mesh_run 控制 id；生命周期由 mesh-run-control 编排。
 * 不再「整轮跑 runStockCollaboration」——改 mesh-scheduler 时间轮（每 agent 按自己 interval / 事件触发）。
 * 自有定时器，不碰 workflow scheduler / cron-engine。
 */
import { startScheduler, stopScheduler, emitMarketClose, type SchedulerRunner } from './mesh-scheduler'
import { deleteByRun } from './mesh-participant-store'
import { recordCycle, recordError, markStopped } from './mesh-run'

/** 行情来源：S5 用给定/固定快照（不连真 qmt）；盯盘 agent 主动 cycle 时调它取最新。 */
export type SnapshotProvider = () => unknown

export const DEFAULT_TICK_MS = 2500
export const MIN_TICK_MS = 1000

/** 常驻 runner = scheduler 调度态 + 关联的 mesh_run 控制记录 id。 */
export interface ActiveRunner extends SchedulerRunner {
  controlId: string
}

interface RunnerRegistry {
  runners: Map<string, ActiveRunner>
}

// 注册表挂 globalThis：Next 多次 import 同模块实例仍共享，进程级唯一。
const g = globalThis as unknown as { __meshRunnerRegistry?: RunnerRegistry }
function registry(): RunnerRegistry {
  if (!g.__meshRunnerRegistry) g.__meshRunnerRegistry = { runners: new Map() }
  return g.__meshRunnerRegistry
}

export function getActiveRunner(accountId: string): ActiveRunner | undefined {
  return registry().runners.get(accountId)
}

export function isRunnerActive(accountId: string): boolean {
  return registry().runners.has(accountId)
}

export function activeAccountIds(): string[] {
  return Array.from(registry().runners.keys())
}

/** 启动常驻 session 的时间轮（participant 行已由 run-control 建好；这里只起调度循环）。 */
export function startRunner(opts: {
  controlId: string
  accountId: string
  runId: string
  snapshot: SnapshotProvider
  tickMs?: number
}): ActiveRunner {
  const runner: ActiveRunner = {
    controlId: opts.controlId,
    runId: opts.runId,
    accountId: opts.accountId,
    tickMs: opts.tickMs ?? DEFAULT_TICK_MS,
    abort: new AbortController(),
    snapshot: opts.snapshot,
    inFlight: new Set(),
    ticker: null,
    stopped: false,
    onError: (msg) => recordError(opts.controlId, msg),
    onCycle: () => recordCycle(opts.controlId),
  }
  registry().runners.set(opts.accountId, runner)
  startScheduler(runner) // 立即首 tick，跑完自排下次
  return runner
}

/** 手动触发收盘事件（演示/测试用）：找该账户活跃 runner，emit market_close 唤醒复盘。无活跃 runner 返回 false。 */
export function emitMarketCloseNow(accountId: string): boolean {
  const runner = registry().runners.get(accountId)
  if (!runner) return false
  emitMarketClose(runner)
  return true
}

/** 停止：停时间轮 + abort 所有在飞 duty cycle + 清 participant 行（§75 不挂起恢复）+ mesh_run 终态。 */
export function stopRunner(accountId: string): boolean {
  const runner = registry().runners.get(accountId)
  if (!runner) return false
  stopScheduler(runner) // stopped=true + clearTimeout + abort（透传给在飞 SDK）
  deleteByRun(runner.runId)
  registry().runners.delete(accountId)
  markStopped(runner.controlId)
  return true
}
