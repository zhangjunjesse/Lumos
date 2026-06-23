/**
 * 单次 duty cycle 执行核 —— 一个 agent 醒来一次：构 prompt → 跑 SDK → 应用 action plan。
 * 复用 runtime 的 applyActionPlan（outbox 单事务 + 下单确定性链）。
 * 调度器（mesh-scheduler）按主动 timer / 被动事件触发它；这里只管"跑一次"，不管"何时跑"。
 * 设计 §268-284：读白板+自己状态 → mesh-worker 跑一次 → action plan → 单事务写 outbox。
 */
import { runMeshActor } from './mesh-worker'
import { applyActionPlan, type MeshParticipant, type TradeContext } from './mesh-runtime'
import { buildActiveLoopPrompt, buildEventPrompt, buildTaskPrompt, buildReplyPrompt, buildReviewPrompt, conversationLines } from './mesh-prompts'

/** 被动触发时消费的一条 pending 投递（事件/任务/回执）。 */
export interface DutyDelivery {
  messageId: string
  subscriberId: string
  topic: string
  payload: unknown
  taskId?: string | null
}

export interface DutyCycleInput {
  runId: string
  participant: MeshParticipant
  /** timer=主动到点（盯盘/复盘/巡检）；event=被一条投递唤醒。 */
  trigger: 'timer' | 'event'
  delivery?: DutyDelivery | null
  /** 持久自增序号，进下单幂等键（防常驻 runId 跨 cycle 撞 key）。 */
  cycleSeq: number
  subscribersOf: (topic: string) => string[]
  tradeCtx: TradeContext
  /** 盯盘 timer 触发时的最新行情快照。 */
  snapshot?: unknown
  focus?: string
  abortController?: AbortController
  sessionId?: string
}

export interface DutyCycleResult {
  thought: string
  writes: string[]
  emits: string[]
  orders: string[]
}

export async function runOneDutyCycle(input: DutyCycleInput): Promise<DutyCycleResult> {
  const prompt = buildPrompt(input)
  const { plan } = await runMeshActor(input.participant.agent, prompt, {
    sessionId: input.sessionId,
    abortController: input.abortController,
  })
  if (input.abortController?.signal.aborted) return { thought: plan.thought, writes: [], emits: [], orders: [] }
  const consumed = input.delivery
    ? { messageId: input.delivery.messageId, subscriberId: input.delivery.subscriberId }
    : null
  const { writes, emits, orders } = await applyActionPlan(
    input.runId,
    input.participant,
    plan,
    consumed,
    input.subscribersOf,
    input.tradeCtx,
    input.cycleSeq,
    { abortSignal: input.abortController?.signal },
  )
  return { thought: plan.thought, writes, emits, orders }
}

/** 选 prompt 并前置「最近对话」记忆块——让无状态的 agent 跨 cycle 记住用户的指令与纠正。 */
function buildPrompt(input: DutyCycleInput): string {
  return conversationLines(input.runId, input.participant.agent.id) + buildBasePrompt(input)
}

/** 按触发类型选 base prompt：事件按 topic 分流，timer 走主动巡检。 */
function buildBasePrompt(input: DutyCycleInput): string {
  if (input.trigger === 'event' && input.delivery) {
    const { topic, payload, taskId } = input.delivery
    if (topic === 'agent_task') return buildTaskPrompt(input.runId, payload, taskId ?? '')
    if (topic === 'agent_reply') return buildReplyPrompt(input.runId, payload)
    if (topic === 'market_close') return buildReviewPrompt(input.runId) // 收盘 → 复盘归因
    return buildEventPrompt(input.runId, topic, payload)
  }
  return buildActiveLoopPrompt(input.runId, input.participant.agent.role, input.snapshot, input.focus)
}
