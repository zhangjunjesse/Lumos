/**
 * mesh duty cycle 的 prompt 构造 —— 从 runtime 抽出，供整轮编排（runCollaborationOnce）和
 * 常驻 duty cycle（runOneDutyCycle）共用。
 * 触发分两类：主动（active_loop timer：盯盘/复盘/巡检）+ 被动（事件/定向任务/回执唤醒）。
 */
import { readAllBlackboard } from './mesh-blackboard'
import { recentAgentMessages } from './mesh-event-bus'
import type { MeshAgentRole } from './mesh-agent-config'

/** 白板当前全 key 摘要（每行一条）。 */
function boardLines(runId: string): string {
  return readAllBlackboard(runId)
    .map((e) => `- ${e.key}: ${JSON.stringify(e.value)}`)
    .join('\n')
}

/**
 * 某 agent 最近的对话记忆块（发给它的指令/任务 + 它自己的回复），拼成可前置的上下文；无对话则空串。
 * 解决 mesh agent 无状态、跨 cycle 不记得用户纠正的问题（每轮 query 都是全新调用）。
 */
export function conversationLines(runId: string, agentId: string): string {
  const msgs = recentAgentMessages(runId, agentId, 12)
  if (msgs.length === 0) return ''
  const lines = msgs
    .map((m) => {
      const p = (m.payload ?? {}) as { summary?: string }
      const who = m.from === agentId ? '你' : m.from === 'user' ? '用户' : m.from
      const text = p.summary ?? (typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload))
      return `- ${who}：${text}`
    })
    .join('\n')
  return `你最近的对话（延续其中对你的指令与纠正，别重犯已被指出的错）：\n${lines}\n\n`
}

/** 整轮编排起步 prompt（runCollaborationOnce 用；接快照字段子集，不耦合 CollaborationSeed）。 */
export function buildSeedPrompt(seed: { snapshotKey: string; snapshot: unknown; focus?: string }): string {
  const focusLine = seed.focus ? `\n关注重点：${seed.focus}` : ''
  return `行情快照(${seed.snapshotKey})：\n${JSON.stringify(seed.snapshot, null, 2)}${focusLine}\n\n基于快照判断。若发现值得交易关注的异动，emit_event 一个 topic="quote_anomaly"、payload 带股票代码和理由，并把观察写入白板。`
}

/** 事件订阅唤醒（emit_event 广播）。 */
export function buildEventPrompt(runId: string, topic: string, payload: unknown): string {
  return `你被事件 "${topic}" 唤醒，事件内容：${JSON.stringify(payload)}\n\n当前白板：\n${boardLines(runId)}\n\n据此产出 action plan。`
}

/** 复盘 prompt（归因）。 */
export function buildReviewPrompt(runId: string): string {
  return `本轮协作结束，白板全部记录：\n${boardLines(runId)}\n\n做一段简明归因复盘，write_blackboard key="review"。`
}

/** 收到定向任务（send_task）。 */
export function buildTaskPrompt(runId: string, payload: unknown, taskId: string): string {
  const p = (payload ?? {}) as { summary?: string; from?: string }
  return `你收到一个定向任务（taskId=${taskId}），来自 ${p.from ?? '?'}：${p.summary ?? ''}\n\n当前白板：\n${boardLines(runId)}\n\n处理这个任务。完成后必须用 reply action 回执（带上 taskId="${taskId}"，summary 写你的结论）。`
}

/** 收到回执（reply）。 */
export function buildReplyPrompt(runId: string, payload: unknown): string {
  const p = (payload ?? {}) as { summary?: string; taskId?: string }
  return `你派出的任务（taskId=${p.taskId ?? '?'}）收到回执：${p.summary ?? ''}\n\n当前白板：\n${boardLines(runId)}\n\n据此产出后续 action（如把结果 write_blackboard 记录）。`
}

/**
 * 主动 duty cycle（active_loop 按 next_run_at 醒来）：只喂通用上下文——被定时唤醒 + observe 角色带最新行情快照 + 当前白板。
 * 具体职责由各 agent 自己的 systemPrompt 定义，这里**不写死角色职责**，自定义 agent 才能按自己的提示词干活。
 */
export function buildActiveLoopPrompt(runId: string, role: MeshAgentRole, snapshot: unknown, focus?: string): string {
  // custom = 零内置逻辑:不喂行情、不喂共享白板(避免炒股团队的 market_snapshot 等噪音带偏),纯按用户 systemPrompt 跑。
  if (role === 'custom') {
    return `你被定时唤醒。严格按你的系统提示词产出本轮 action plan,并把这轮结果用 write_blackboard 留痕(key 自取)。不要做系统提示词以外的事。`
  }
  const board = boardLines(runId)
  // observe 到点带上最新行情快照作上下文;其余角色只看白板。
  const snapshotBlock =
    role === 'observe' && snapshot !== undefined
      ? `最新行情快照(供参考)：\n${JSON.stringify(snapshot, null, 2)}${focus ? `\n关注重点：${focus}` : ''}\n\n`
      : ''
  return `你被定时唤醒,轮到你主动履职。\n\n${snapshotBlock}当前白板：\n${board}\n\n按你的系统提示词(职责)产出 action plan：thought 写清这轮做了什么;需要留痕用 write_blackboard,需要通知队友用 emit_event/send_task。确无可做就 write_blackboard 写一句说明,不要硬造动作。`
}
