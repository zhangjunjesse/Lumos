/**
 * 常驻盯盘生命周期控制 —— 唯一编排入口（route 不散写生命周期，守 CLAUDE.md 任务生命周期铁律）。
 * start：清孤儿 → 建 mesh_run → 启 runner（同账户已在跑则拒）。
 * stop：停 runner（清 timer + abort 当轮 + mesh_run 终态）；内存无 runner 则清孤儿记录。
 * status：内存 runner 为"在跑"真相 + mesh_run 审计 + 账户快照。
 */
import { createRun, getRunningRun, listRunningRuns, markStopped, type MeshRunRow } from './mesh-run'
import {
  startRunner,
  stopRunner,
  isRunnerActive,
  getActiveRunner,
  type SnapshotProvider,
} from './mesh-runner'
import { getAccount, type PaperAccount } from './mesh-paper-account'

export const DEFAULT_ACCOUNT_ID = 'mesh_team_default'
const MIN_INTERVAL_MS = 3000
const DEFAULT_INTERVAL_MS = 60000

/** 清孤儿：mesh_run=running 但内存无 runner（多为进程重启遗留）→ 标 stopped。返回清理条数。 */
export function reconcileOrphans(): number {
  let cleared = 0
  for (const run of listRunningRuns()) {
    if (!isRunnerActive(run.accountId)) {
      markStopped(run.id)
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
  intervalMs?: number
  snapshot: SnapshotProvider
}): StartResult {
  reconcileOrphans()
  const accountId = opts.accountId ?? DEFAULT_ACCOUNT_ID
  if (isRunnerActive(accountId)) return { ok: false, reason: '该账户已在盯盘中' }
  const intervalMs = Math.max(MIN_INTERVAL_MS, opts.intervalMs ?? DEFAULT_INTERVAL_MS)
  const run = createRun(accountId, intervalMs)
  startRunner({ controlId: run.id, accountId, intervalMs, snapshot: opts.snapshot })
  return { ok: true, run }
}

export interface StopResult {
  ok: boolean
  reason?: string
}

export function stopMonitoring(accountId: string = DEFAULT_ACCOUNT_ID): StopResult {
  if (stopRunner(accountId)) return { ok: true }
  const orphan = getRunningRun(accountId)
  if (orphan) {
    markStopped(orphan.id)
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
    rounds: runner?.rounds ?? run?.rounds ?? 0,
    intervalMs: runner?.intervalMs ?? run?.intervalMs ?? null,
    run,
    account: getAccount(accountId),
  }
}
