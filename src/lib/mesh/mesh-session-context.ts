/**
 * 常驻 session 运行上下文 —— 每个 duty cycle 派发前「现读」团队配置组装（按 workshopId 隔离）。
 * 现读而非缓存：用户中途改 mode/黑名单/关注/agent 配置，下一个 cycle 立即生效（常驻的优势）。
 * workshopId 复用 accountId 维度：scheduler 的 runner.accountId 即 workshopId。
 */
import { getTeamConfig } from './mesh-team-config'
import { getRiskRules } from './mesh-risk-store'
import { getLiveConfig } from './mesh-live-backend'
import { listAgents, getAgent } from './mesh-agent-store'
import type { ParticipantSeed } from './mesh-participant-store'
import type { MeshParticipant, TradeContext } from './mesh-runtime'

/** 该工作室 enabled 协作成员（队长除外）→ participant 种子，供 start 时 initParticipants 建行。 */
export function buildSessionSeeds(workshopId: string): ParticipantSeed[] {
  return listAgents(workshopId, { enabled: true })
    .filter((a) => a.role !== 'leader')
    .map((a) => ({ participantId: a.id, role: a.role, subscriptions: a.topics, workMode: a.workMode }))
}

/** 现读该工作室 team config + 风控 + 全局 live，组装下单上下文（accountId = workshopId）。 */
export function buildTradeContext(workshopId: string): TradeContext {
  const config = getTeamConfig(workshopId)
  const live = getLiveConfig()
  const stored = getRiskRules(workshopId)
  return {
    mode: config.mode,
    rules: { ...stored, blacklist: Array.from(new Set([...stored.blacklist, ...config.blacklist])) },
    accountId: workshopId,
    tradeMode: live.tradeMode,
    liveEnabled: live.liveEnabled,
  }
}

/** topic → 订阅它的 enabled agent（队长不在协作链）。每 cycle 现算，topics 改了立即生效。 */
export function buildSubscribersOf(workshopId: string): (topic: string) => string[] {
  const agents = listAgents(workshopId, { enabled: true }).filter((a) => a.role !== 'leader')
  return (topic) => agents.filter((a) => a.topics.includes(topic)).map((a) => a.id)
}

/** 按 id 组装 MeshParticipant（停用/不存在返回 null，调度器据此跳过）。 */
export function buildParticipant(workshopId: string, agentId: string): MeshParticipant | null {
  const a = getAgent(workshopId, agentId)
  if (!a || !a.enabled) return null
  return { agent: a, topics: a.topics }
}

export function getSessionFocus(workshopId: string): string {
  return getTeamConfig(workshopId).focus
}

/** agent 主动循环间隔（秒→毫秒）；缺省 60s。现读 registry，用户改 interval 下次排程生效。 */
export function getAgentIntervalMs(workshopId: string, agentId: string): number {
  return (getAgent(workshopId, agentId)?.interval ?? 60) * 1000
}
