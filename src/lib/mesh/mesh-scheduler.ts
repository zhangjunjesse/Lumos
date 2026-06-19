/**
 * 时间轮调度器 —— 常驻 session 的「每 agent 各自 duty loop」核心（设计 §272-275/§387）。
 * tick（~2.5s）只做「选 due + 门控派发」，绝不 await SDK；duty cycle 是 fire-and-forget +
 * inFlight 锁（同 agent 不重叠）+ MAX_CONCURRENT 限速。事件/任务优先于主动 timer。
 * 自有定时器，不碰 workflow scheduler / cron-engine。
 */
import { listPendingDeliveries } from './mesh-event-bus'
import { queryDueParticipants, getParticipant, updateParticipant, nextCycleSeq } from './mesh-participant-store'
import { runOneDutyCycle, type DutyDelivery } from './mesh-duty-cycle'
import { buildParticipant, buildSubscribersOf, buildTradeContext, getSessionFocus, getAgentIntervalMs } from './mesh-session-context'
import type { SnapshotProvider } from './mesh-runner'

export const MAX_CONCURRENT = 3
export const MAX_DISPATCH_PER_TICK = 5
export const IDLE_BACKOFF_CAP = 5

export interface SchedulerRunner {
  runId: string
  accountId: string
  tickMs: number
  abort: AbortController
  snapshot: SnapshotProvider
  inFlight: Set<string>
  ticker: ReturnType<typeof setTimeout> | null
  stopped: boolean
  onError?: (msg: string) => void
  onCycle?: () => void
}

export interface DueItem {
  participantId: string
  trigger: 'timer' | 'event'
  delivery: DutyDelivery | null
}

/** 选「该跑谁」：pending 投递（事件/任务/回执）优先，主动 timer 其次；同 agent 本 tick 只领一条。 */
export function selectDue(runId: string, now: number): DueItem[] {
  const items: DueItem[] = []
  const seen = new Set<string>()
  for (const d of listPendingDeliveries(runId)) {
    if (seen.has(d.subscriberId)) continue
    seen.add(d.subscriberId)
    items.push({
      participantId: d.subscriberId,
      trigger: 'event',
      delivery: { messageId: d.messageId, subscriberId: d.subscriberId, topic: d.topic, payload: d.payload, taskId: d.taskId },
    })
  }
  for (const p of queryDueParticipants(runId, now)) {
    if (seen.has(p.participantId)) continue
    items.push({ participantId: p.participantId, trigger: 'timer', delivery: null })
  }
  return items
}

/** 门控：并发上限 + 单 tick 上限 + 同 agent 不重叠（基于当前 inFlight 投影）。 */
export function pickDispatchable(due: DueItem[], inFlight: Set<string>): DueItem[] {
  const pick: DueItem[] = []
  const projected = new Set(inFlight)
  for (const item of due) {
    if (projected.size >= MAX_CONCURRENT) break
    if (pick.length >= MAX_DISPATCH_PER_TICK) break
    if (projected.has(item.participantId)) continue
    projected.add(item.participantId)
    pick.push(item)
  }
  return pick
}

/** 空转退避：连续无产出（无 emit/order）则指数延长下次（封顶 IDLE_BACKOFF_CAP 档）。 */
export function computeNextRunAt(intervalMs: number, idleStreak: number, now: number): number {
  return now + intervalMs * 2 ** Math.min(idleStreak, IDLE_BACKOFF_CAP)
}

/** 一次 tick：选 due → 门控 → fire-and-forget 派发 → 排下一 tick。永远轻快。 */
export function tickLoop(runner: SchedulerRunner): void {
  if (runner.stopped || runner.abort.signal.aborted) return
  const pick = pickDispatchable(selectDue(runner.runId, Date.now()), runner.inFlight)
  for (const item of pick) {
    runner.inFlight.add(item.participantId)
    void dispatchDutyCycle(runner, item)
  }
  runner.ticker = setTimeout(() => tickLoop(runner), runner.tickMs)
}

/** 派发一次 duty cycle（异步本体）：现读配置 → runOneDutyCycle → 排下次。abort 后不排。 */
export async function dispatchDutyCycle(runner: SchedulerRunner, item: DueItem): Promise<void> {
  const { runId } = runner
  let productive = false
  try {
    if (runner.abort.signal.aborted) return
    const participant = buildParticipant(item.participantId)
    if (!participant) return
    const cycleSeq = nextCycleSeq(runId, item.participantId)
    const result = await runOneDutyCycle({
      runId,
      participant,
      trigger: item.trigger,
      delivery: item.delivery,
      cycleSeq,
      subscribersOf: buildSubscribersOf(),
      tradeCtx: buildTradeContext(runner.accountId),
      snapshot: runner.snapshot(),
      focus: getSessionFocus(),
      abortController: runner.abort,
    })
    productive = result.emits.length > 0 || result.orders.length > 0
    runner.onCycle?.()
  } catch (err) {
    if (runner.abort.signal.aborted) return
    runner.onError?.(String((err as Error)?.message ?? err))
  } finally {
    runner.inFlight.delete(item.participantId)
    if (!runner.abort.signal.aborted) scheduleNext(runId, item.participantId, productive)
  }
}

/** active_loop 跑完排下次（含空转退避）；event_driven 不主动排（等下次事件唤醒）。 */
function scheduleNext(runId: string, participantId: string, productive: boolean): void {
  const p = getParticipant(runId, participantId)
  if (!p || p.workMode !== 'active_loop') return
  const idleStreak = productive ? 0 : p.idleStreak + 1
  const now = Date.now()
  updateParticipant(runId, participantId, {
    nextRunAt: computeNextRunAt(getAgentIntervalMs(participantId), idleStreak, now),
    lastRunAt: now,
    idleStreak,
  })
}

/** 启动调度（立即首 tick，跑完自排下次）。 */
export function startScheduler(runner: SchedulerRunner): void {
  tickLoop(runner)
}

/** 停止调度：清 ticker + abort（透传给所有在飞 duty cycle 的 SDK）。 */
export function stopScheduler(runner: SchedulerRunner): void {
  runner.stopped = true
  if (runner.ticker) clearTimeout(runner.ticker)
  runner.abort.abort()
}
