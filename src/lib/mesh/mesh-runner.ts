/**
 * 常驻盯盘 runner —— setTimeout 链跑多轮 paper 协作（跑完一轮 + 间隔再排下一轮，绝不重叠）。
 * 内存注册表（globalThis）持 timer + abortController；生命周期由 mesh-run-control 编排。
 * 自有定时器，不碰 workflow scheduler / cron-engine。
 */
import { runStockCollaboration } from './mesh-collaboration'
import { recordRound, recordError, markStopped } from './mesh-run'

/** 每轮行情来源：M7 用给定/固定快照（不连真 qmt）。 */
export type SnapshotProvider = () => unknown

export interface ActiveRunner {
  controlId: string
  accountId: string
  intervalMs: number
  timer: ReturnType<typeof setTimeout> | null
  abort: AbortController
  rounds: number
  stopped: boolean
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

export function startRunner(opts: {
  controlId: string
  accountId: string
  intervalMs: number
  snapshot: SnapshotProvider
}): ActiveRunner {
  const runner: ActiveRunner = {
    controlId: opts.controlId,
    accountId: opts.accountId,
    intervalMs: opts.intervalMs,
    timer: null,
    abort: new AbortController(),
    rounds: 0,
    stopped: false,
  }
  registry().runners.set(opts.accountId, runner)
  void runLoop(runner, opts.snapshot) // 立刻跑第一轮，跑完自排下一轮
  return runner
}

async function runLoop(runner: ActiveRunner, snapshot: SnapshotProvider): Promise<void> {
  if (runner.stopped || runner.abort.signal.aborted) return
  try {
    const result = await runStockCollaboration(snapshot(), {
      accountId: runner.accountId,
      abortController: runner.abort,
    })
    runner.rounds += 1
    recordRound(runner.controlId, result.runId)
  } catch (err) {
    if (runner.abort.signal.aborted) return // 被 stop 中断当轮，不算错
    recordError(runner.controlId, String((err as Error)?.message ?? err))
  }
  if (runner.stopped || runner.abort.signal.aborted) return
  runner.timer = setTimeout(() => void runLoop(runner, snapshot), runner.intervalMs)
}

/** 停止：清 timer + abort 当轮 + 从注册表移除 + mesh_run 写终态。返回是否确有活跃 runner。 */
export function stopRunner(accountId: string): boolean {
  const runner = registry().runners.get(accountId)
  if (!runner) return false
  runner.stopped = true
  if (runner.timer) clearTimeout(runner.timer)
  runner.abort.abort()
  registry().runners.delete(accountId)
  markStopped(runner.controlId)
  return true
}
