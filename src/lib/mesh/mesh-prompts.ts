/**
 * mesh duty cycle 的 prompt 构造 —— 从 runtime 抽出，供整轮编排（runCollaborationOnce）和
 * 常驻 duty cycle（runOneDutyCycle）共用。
 * 触发分两类：主动（active_loop timer：盯盘/复盘/巡检）+ 被动（事件/定向任务/回执唤醒）。
 */
import { readAllBlackboard } from './mesh-blackboard'
import type { MeshAgentRole } from './mesh-agent-config'

/** 白板当前全 key 摘要（每行一条）。 */
function boardLines(runId: string): string {
  return readAllBlackboard(runId)
    .map((e) => `- ${e.key}: ${JSON.stringify(e.value)}`)
    .join('\n')
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
 * 主动 duty cycle（active_loop 按 next_run_at 醒来）：盯盘看最新快照找新异动、复盘归因、其余按职责巡检。
 * 设计 §64-76：责任常驻、自己负责一摊事，不是只等事件。
 */
export function buildActiveLoopPrompt(runId: string, role: MeshAgentRole, snapshot: unknown, focus?: string): string {
  if (role === 'review') return buildReviewPrompt(runId)
  const board = boardLines(runId)
  if (role === 'observe') {
    const focusLine = focus ? `\n关注重点：${focus}` : ''
    return `你是常驻盯盘 agent，轮到你看盘了。最新行情快照：\n${JSON.stringify(snapshot, null, 2)}${focusLine}\n\n当前白板：\n${board}\n\n发现值得交易关注的异动（放量突破、涨跌停附近、主线龙头异动、明确低吸/止盈点等）就**必须** emit_event 一个 topic="quote_anomaly"、payload 带 code 和 reason，并把观察写白板 key="watch_note"。\n去重：仅当白板 watch_note 显示你**已就同一标的的同一异动**提示过、本次快照又无变化时，才跳过 emit、只更新 watch_note。注意 market_snapshot 是待你分析的实时行情、不是你的历史观察，别因为"和快照一致"就压制首次提示。确实毫无异动才写一句"无异动"且不 emit。`
  }
  return `轮到你（${role}）巡检。当前白板：\n${board}\n\n按你的职责产出 action plan；确无可做时只写一句白板说明，不要硬造动作。`
}
