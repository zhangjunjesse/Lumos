/**
 * 网状协作运行时 —— participant 编排 + 触发循环 + outbox 单事务 + order_intent 路由。
 *
 * 团队配置（来自 Leader/Control Plane）经 seed 注入：
 * - mode='observe_only' → order_intent 一律跳过下单（只看不买）
 * - riskRules（含黑名单）→ 传给 Risk Gate
 * - focus → 注入盯盘 prompt
 *
 * order_intent 不是下单本身：经确定性 Risk Gate + OrderGateway（paper）才可能成交。
 * 单向链 + 迭代上限 = 天然收敛。不 import workflow / team-run。
 */
import { randomUUID } from 'crypto'
import { getDb } from '@/lib/db/connection'
import { writeBlackboard, readBlackboard, readAllBlackboard } from './mesh-blackboard'
import { persistMessage, markDelivered, listPendingDeliveries, wake, findTaskFrom, type MeshEvent } from './mesh-event-bus'
import { runMeshActor } from './mesh-worker'
import { placeOrder } from './mesh-order-gateway'
import { initAccount, getAccount, type PaperAccount } from './mesh-paper-account'
import type { RiskRules } from './mesh-risk-rules'
import type { MeshActionPlan } from './mesh-action-schema'
import type { MeshAgentConfig } from './mesh-agent-config'

export interface MeshParticipant {
  agent: MeshAgentConfig
  topics: string[]
}

export interface TraceStep {
  participantId: string
  trigger: string
  thought: string
  writes: string[]
  emits: string[]
  orders: string[]
}

export interface CollaborationSeed {
  snapshotKey: string
  snapshot: unknown
  starterId: string
  initialCash?: number
  reviewerId?: string
  riskRules?: RiskRules
  mode?: 'auto' | 'observe_only'
  focus?: string
  /** 常驻团队账户标识；缺省回落每轮 runId（单轮 per-run，行为不变）。 */
  accountId?: string
  /** 交易模式：paper 本地撮合 / live 走真盘后端。默认 paper。 */
  tradeMode?: 'paper' | 'live'
  /** live 总开关：默认关，关时 live 单直接拒、不碰真盘后端。 */
  liveEnabled?: boolean
}

export interface CollaborationResult {
  runId: string
  trace: TraceStep[]
  decision: unknown
  account: PaperAccount | null
}

interface TradeContext {
  mode: 'auto' | 'observe_only'
  rules?: RiskRules
  accountId: string
  tradeMode: 'paper' | 'live'
  liveEnabled: boolean
}

const MAX_ITERATIONS = 12
const DEFAULT_PAPER_CASH = 100000
export const MARKET_SNAPSHOT_KEY = 'market_snapshot'

export async function runCollaborationOnce(
  participants: MeshParticipant[],
  seed: CollaborationSeed,
  options: { sessionId?: string; abortController?: AbortController } = {},
): Promise<CollaborationResult> {
  const runId = `mrun_${randomUUID()}`
  const accountId = seed.accountId ?? runId
  const trace: TraceStep[] = []
  const byId = new Map(participants.map((p) => [p.agent.id, p]))
  const subscribersOf = (topic: string) =>
    participants.filter((p) => p.topics.includes(topic)).map((p) => p.agent.id)
  const tradeCtx: TradeContext = {
    mode: seed.mode ?? 'auto',
    rules: seed.riskRules,
    accountId,
    tradeMode: seed.tradeMode ?? 'paper',
    liveEnabled: seed.liveEnabled ?? false,
  }

  initAccount(accountId, seed.initialCash ?? DEFAULT_PAPER_CASH)
  writeBlackboard(runId, seed.snapshotKey, seed.snapshot, 'seed')

  const starter = byId.get(seed.starterId)
  if (!starter) throw new Error(`unknown starter participant: ${seed.starterId}`)
  await runParticipant(runId, starter, buildSeedPrompt(seed), 'seed', null, subscribersOf, tradeCtx, trace, options)

  let iter = 0
  while (iter < MAX_ITERATIONS) {
    if (options.abortController?.signal.aborted) break
    const pending = listPendingDeliveries(runId)
    if (pending.length === 0) break
    const d = pending[0]
    const p = byId.get(d.subscriberId)
    if (!p) {
      markDelivered(d.messageId, d.subscriberId, 'failed')
      continue
    }
    const prompt =
      d.topic === 'agent_task'
        ? buildTaskPrompt(runId, d.payload, d.taskId ?? '')
        : d.topic === 'agent_reply'
          ? buildReplyPrompt(runId, d.payload)
          : buildEventPrompt(runId, d.topic, d.payload)
    await runParticipant(
      runId,
      p,
      prompt,
      `event:${d.topic}`,
      { messageId: d.messageId, subscriberId: d.subscriberId },
      subscribersOf,
      tradeCtx,
      trace,
      options,
    )
    iter++
  }

  if (seed.reviewerId) {
    const reviewer = byId.get(seed.reviewerId)
    if (reviewer) {
      await runParticipant(runId, reviewer, buildReviewPrompt(runId), 'review', null, subscribersOf, tradeCtx, trace, options)
    }
  }

  const decision = readBlackboard(runId, 'decision')?.value ?? null
  return { runId, trace, decision, account: getAccount(accountId) }
}

async function runParticipant(
  runId: string,
  participant: MeshParticipant,
  prompt: string,
  trigger: string,
  consumed: { messageId: string; subscriberId: string } | null,
  subscribersOf: (topic: string) => string[],
  tradeCtx: TradeContext,
  trace: TraceStep[],
  options: { sessionId?: string; abortController?: AbortController },
): Promise<void> {
  const { plan } = await runMeshActor(participant.agent, prompt, {
    sessionId: options.sessionId,
    abortController: options.abortController,
  })
  const { writes, emits, orders } = await applyActionPlan(runId, participant, plan, consumed, subscribersOf, tradeCtx)
  trace.push({ participantId: participant.agent.id, trigger, thought: plan.thought, writes, emits, orders })
}

async function applyActionPlan(
  runId: string,
  participant: MeshParticipant,
  plan: MeshActionPlan,
  consumed: { messageId: string; subscriberId: string } | null,
  subscribersOf: (topic: string) => string[],
  tradeCtx: TradeContext,
): Promise<{ writes: string[]; emits: string[]; orders: string[] }> {
  const writes: string[] = []
  const emits: string[] = []
  const orders: string[] = []
  const wakeups: Array<{ topic: string; event: MeshEvent }> = []
  const orderIntents: Array<{ action: { symbol: string; side: 'buy' | 'sell'; qty: number }; idx: number }> = []
  const snapshot = readBlackboard(runId, MARKET_SNAPSHOT_KEY)?.value

  getDb().transaction(() => {
    plan.actions.forEach((action, idx) => {
      if (action.type === 'write_blackboard') {
        writeBlackboard(runId, action.key, action.value, participant.agent.id)
        writes.push(action.key)
      } else if (action.type === 'emit_event') {
        const subs = subscribersOf(action.topic)
        const messageId = persistMessage(runId, action.topic, action.payload, participant.agent.id, subs)
        wakeups.push({
          topic: action.topic,
          event: { id: messageId, runId, topic: action.topic, payload: action.payload, from: participant.agent.id },
        })
        emits.push(action.topic)
      } else if (action.type === 'send_task') {
        const taskId = randomUUID()
        const payload = { summary: action.summary, from: participant.agent.id, to: action.to }
        const messageId = persistMessage(runId, 'agent_task', payload, participant.agent.id, [action.to], taskId)
        wakeups.push({ topic: 'agent_task', event: { id: messageId, runId, topic: 'agent_task', payload, from: participant.agent.id } })
        emits.push(`task→${action.to}`)
      } else if (action.type === 'reply') {
        const origFrom = findTaskFrom(runId, action.taskId)
        if (origFrom) {
          const payload = { summary: action.summary, taskId: action.taskId }
          const messageId = persistMessage(runId, 'agent_reply', payload, participant.agent.id, [origFrom], action.taskId)
          wakeups.push({ topic: 'agent_reply', event: { id: messageId, runId, topic: 'agent_reply', payload, from: participant.agent.id } })
          emits.push(`reply→${origFrom}`)
        }
      } else if (action.type === 'order_intent') {
        orderIntents.push({ action, idx })
      }
    })
    if (consumed) markDelivered(consumed.messageId, consumed.subscriberId)
  })()

  for (const w of wakeups) wake(runId, w.topic, w.event)
  // 事务提交后再下单（paper 立即/live 走 IPC 异步）；ticket 幂等键保证不重复下单。
  for (const oi of orderIntents) {
    orders.push(await handleOrderIntent(runId, participant.agent.id, oi.action, oi.idx, snapshot, tradeCtx))
  }
  return { writes, emits, orders }
}

async function handleOrderIntent(
  runId: string,
  agentId: string,
  action: { symbol: string; side: 'buy' | 'sell'; qty: number },
  idx: number,
  snapshot: unknown,
  tradeCtx: TradeContext,
): Promise<string> {
  if (tradeCtx.mode === 'observe_only') {
    writeBlackboard(runId, `order_result:${action.symbol}`, { intent: action, status: 'skipped', reason: 'observe_only(只看不买)' }, agentId)
    return `${action.side} ${action.symbol} x${action.qty} → skipped(observe_only)`
  }
  const result = await placeOrder(
    runId,
    { symbol: action.symbol, side: action.side, qty: action.qty },
    { idempotencyKey: `${runId}:${agentId}:${idx}`, snapshot, rules: tradeCtx.rules, accountId: tradeCtx.accountId, mode: tradeCtx.tradeMode, liveEnabled: tradeCtx.liveEnabled },
  )
  writeBlackboard(runId, `order_result:${action.symbol}`, { intent: action, ...result }, agentId)
  return `${action.side} ${action.symbol} x${action.qty} → ${result.status}` + (result.filled ? ` @${result.price}` : `(${result.reason})`)
}

function buildSeedPrompt(seed: CollaborationSeed): string {
  const focusLine = seed.focus ? `\n关注重点：${seed.focus}` : ''
  return `行情快照(${seed.snapshotKey})：\n${JSON.stringify(seed.snapshot, null, 2)}${focusLine}\n\n基于快照判断。若发现值得交易关注的异动，emit_event 一个 topic="quote_anomaly"、payload 带股票代码和理由，并把观察写入白板。`
}

function buildEventPrompt(runId: string, topic: string, payload: unknown): string {
  const board = readAllBlackboard(runId)
    .map((e) => `- ${e.key}: ${JSON.stringify(e.value)}`)
    .join('\n')
  return `你被事件 "${topic}" 唤醒，事件内容：${JSON.stringify(payload)}\n\n当前白板：\n${board}\n\n据此产出 action plan。`
}

function buildReviewPrompt(runId: string): string {
  const board = readAllBlackboard(runId)
    .map((e) => `- ${e.key}: ${JSON.stringify(e.value)}`)
    .join('\n')
  return `本轮协作结束，白板全部记录：\n${board}\n\n做一段简明归因复盘，write_blackboard key="review"。`
}

function buildTaskPrompt(runId: string, payload: unknown, taskId: string): string {
  const board = readAllBlackboard(runId)
    .map((e) => `- ${e.key}: ${JSON.stringify(e.value)}`)
    .join('\n')
  const p = (payload ?? {}) as { summary?: string; from?: string }
  return `你收到一个定向任务（taskId=${taskId}），来自 ${p.from ?? '?'}：${p.summary ?? ''}\n\n当前白板：\n${board}\n\n处理这个任务。完成后必须用 reply action 回执（带上 taskId="${taskId}"，summary 写你的结论）。`
}

function buildReplyPrompt(runId: string, payload: unknown): string {
  const board = readAllBlackboard(runId)
    .map((e) => `- ${e.key}: ${JSON.stringify(e.value)}`)
    .join('\n')
  const p = (payload ?? {}) as { summary?: string; taskId?: string }
  return `你派出的任务（taskId=${p.taskId ?? '?'}）收到回执：${p.summary ?? ''}\n\n当前白板：\n${board}\n\n据此产出后续 action（如把结果 write_blackboard 记录）。`
}
