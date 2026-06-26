/**
 * 常驻盯盘生命周期控制 —— 唯一编排入口（route 不散写生命周期，守 CLAUDE.md 任务生命周期铁律）。
 * start：清孤儿 → 建 mesh_run → 启 runner（同账户已在跑则拒）。
 * stop：停 runner（清 timer + abort 当轮 + mesh_run 终态）；内存无 runner 则清孤儿记录。
 * status：内存 runner 为"在跑"真相 + mesh_run 审计 + 账户快照。
 */
import { randomUUID } from 'crypto'
import { createRun, getRunningRun, listRunningRuns, markStopped, type MeshRunRow } from './mesh-run'
import {
  startRunner,
  stopRunner,
  isRunnerActive,
  getActiveRunner,
  MIN_TICK_MS,
  DEFAULT_TICK_MS,
  type SnapshotProvider,
} from './mesh-runner'
import { getAccount, initAccount, DEFAULT_PAPER_CASH, type PaperAccount } from './mesh-paper-account'
import { initParticipants, deleteByRun } from './mesh-participant-store'
import { buildSessionSeeds, teamTrades } from './mesh-session-context'
import { writeBlackboard, MARKET_SNAPSHOT_KEY } from './mesh-blackboard'
import { startQuoteFeed, stopQuoteFeed, getQuoteSnapshot } from './mesh-quote-feed'
import { DEFAULT_WORKSHOP_ID } from './mesh-constants'

export const DEFAULT_ACCOUNT_ID = DEFAULT_WORKSHOP_ID // 工作室 id 即账户 id

/** 清孤儿：mesh_run=running 但内存无 runner（多为进程重启遗留）→ 标 stopped。返回清理条数。 */
export function reconcileOrphans(): number {
  let cleared = 0
  for (const run of listRunningRuns()) {
    if (!isRunnerActive(run.accountId)) {
      markStopped(run.id)
      if (run.lastRunId) deleteByRun(run.lastRunId) // 清残留 participant 行（§75 不挂起恢复，重启不自动复活）
      cleared += 1
    }
  }
  return cleared
}

export interface StartResult {
  ok: boolean
  reason?: string
  run?: MeshRunRow
}

export function startMonitoring(opts: {
  accountId?: string
  /** 时间轮 tick 粒度（ms）；盯盘多快由各 agent 自己的 interval 决定，不再是整轮间隔。 */
  intervalMs?: number
  initialCash?: number
  /** 行情供给：不传则启用真行情桥（qmt 实时价，去假数据）；测试/显式 demo 可传固定快照覆盖。 */
  snapshot?: SnapshotProvider
}): StartResult {
  reconcileOrphans()
  const accountId = opts.accountId ?? DEFAULT_ACCOUNT_ID
  if (isRunnerActive(accountId)) return { ok: false, reason: '该账户已在盯盘中' }
  const tickMs = Math.max(MIN_TICK_MS, opts.intervalMs ?? DEFAULT_TICK_MS)
  const runId = `mrun_${randomUUID()}` // 常驻 session id，贯穿 start→stop
  const run = createRun(accountId, tickMs, runId)
  // 交易基建（paper 账户 + 行情桥）只为「会下单」的团队拉起；纯协作/调研团队不建账户、不 spawn python 行情桥。
  const trades = teamTrades(accountId)
  if (trades) initAccount(accountId, opts.initialCash ?? DEFAULT_PAPER_CASH) // 账户跨 cycle 常驻
  initParticipants(runId, buildSessionSeeds(accountId), Date.now()) // accountId 即 workshopId；每 enabled agent 一行运行态
  // 交易团队默认走真行情桥（按持仓取 qmt 实时价、每 5s 刷新黑板快照）；显式传 snapshot 用固定值（测试/demo）。
  if (trades && !opts.snapshot) startQuoteFeed(accountId, runId)
  const snapshot: SnapshotProvider = opts.snapshot ?? (trades ? () => getQuoteSnapshot(accountId) : () => ({ ticks: [] }))
  if (trades || opts.snapshot) writeBlackboard(runId, MARKET_SNAPSHOT_KEY, snapshot(), 'seed') // 交易团队/显式 demo 才写初始行情快照
  startRunner({ controlId: run.id, accountId, runId, snapshot, tickMs })
  return { ok: true, run }
}

export interface StopResult {
  ok: boolean
  reason?: string
}

export async function stopMonitoring(accountId: string = DEFAULT_ACCOUNT_ID): Promise<StopResult> {
  const stopped = await stopRunner(accountId) // 先 drain 在飞 cycle（期间行情桥还活着，prompt 行情不空）
  stopQuoteFeed(accountId) // drain 完再停行情桥（杀 python 子进程）
  if (stopped) return { ok: true }
  if (isRunnerActive(accountId)) return { ok: false, reason: '停止超时：仍有 duty cycle 未退出' }
  const orphan = getRunningRun(accountId)
  if (orphan) {
    markStopped(orphan.id)
    if (orphan.lastRunId) deleteByRun(orphan.lastRunId)
    return { ok: true, reason: '已清理孤儿运行记录（内存无活跃 runner）' }
  }
  return { ok: false, reason: '该账户未在盯盘' }
}

export interface MonitoringStatus {
  accountId: string
  active: boolean
  rounds: number
  intervalMs: number | null
  run: MeshRunRow | null
  account: PaperAccount | null
}

export function monitoringStatus(accountId: string = DEFAULT_ACCOUNT_ID): MonitoringStatus {
  reconcileOrphans()
  const runner = getActiveRunner(accountId)
  const run = getRunningRun(accountId)
  return {
    accountId,
    active: isRunnerActive(accountId),
    rounds: run?.rounds ?? 0,
    intervalMs: runner?.tickMs ?? run?.intervalMs ?? null,
    run,
    account: getAccount(accountId),
  }
}
