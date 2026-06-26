/**
 * 单次 duty cycle 执行核 —— 一个 agent 醒来一次：构 prompt → 跑一轮 SDK。
 * agent 在 turn 内直接调注入的工具（mesh-collab 协作 / mesh-trade 下单）产生副作用——
 * 框架不再"收集 action plan 再单事务执行"，副作用由工具即时落库（写黑板/投递消息/下单）。
 * 调度器（mesh-scheduler）按主动 timer / 被动事件触发它；这里只管"跑一次"，不管"何时跑"。
 * 设计 §268-284。
 */
import { runMeshAgentText } from './mesh-worker'
import { saveMcpStatus } from './mesh-mcp-status'
import { markDelivered } from './mesh-event-bus'
import { MESH_TRADE_MCP_SERVER_NAME } from './mesh-constants'
import type { MeshTradeToolContext } from './mesh-trade-mcp-server'
import type { MeshCollabContext } from './mesh-collab-mcp-server'
import type { MeshParticipant, TradeContext } from './mesh-runtime'
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
  /** 工作室 id（= accountId），MCP 状态按 (workshop, agent) 落库用。 */
  workshopId: string
  participant: MeshParticipant
  /** timer=主动到点（盯盘/复盘/巡检）；event=被一条投递唤醒。 */
  trigger: 'timer' | 'event'
  delivery?: DutyDelivery | null
  /** 持久自增序号，进下单幂等键（防常驻 runId 跨 cycle 撞 key）。 */
  cycleSeq: number
  subscribersOf: (topic: string) => string[]
  tradeCtx: TradeContext
  abortController?: AbortController
  sessionId?: string
}

export interface DutyCycleResult {
  /** agent 本轮的思考文本；副作用已由工具即时落库，这里只回思考供日志/UI。 */
  thought: string
}

export async function runOneDutyCycle(input: DutyCycleInput): Promise<DutyCycleResult> {
  const prompt = buildPrompt(input)
  const agent = input.participant.agent
  // 框架级协作工具:人人可用,带本轮上下文(runId/agentId/当前订阅关系)。
  const collabContext: MeshCollabContext = { runId: input.runId, agentId: agent.id, subscribersOf: input.subscribersOf }
  // 下单上下文:仅当该 agent 白名单声明了下单职责(含 'mesh-trade')才构建并传入——能力隔离,无下单职责的 agent 连上下文都拿不到。
  const tradeContext: MeshTradeToolContext | undefined = agent.mcpAllowlist.includes(MESH_TRADE_MCP_SERVER_NAME)
    ? { runId: input.runId, agentId: agent.id, cycleSeq: input.cycleSeq, trade: input.tradeCtx }
    : undefined
  const { text, mcpStatus } = await runMeshAgentText(agent, prompt, {
    sessionId: input.sessionId,
    abortController: input.abortController,
    collabContext,
    tradeContext,
  })
  if (input.abortController?.signal.aborted) return { thought: text }
  // 副作用已由工具即时产生;这里只在 turn 正常结束后把本次被动投递标记已消费(主动 timer 无投递)。
  if (input.delivery) markDelivered(input.delivery.messageId, input.delivery.subscriberId)
  // 落本轮 MCP 连接状态(connected/failed)供 UI 展示;放履职之后,状态记录不阻断 agent 干活。
  if (mcpStatus) saveMcpStatus(input.workshopId, agent.id, mcpStatus)
  return { thought: text }
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
  return buildActiveLoopPrompt(input.runId)
}
