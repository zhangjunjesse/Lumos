/**
 * 常驻 session 运行上下文 —— 每个 duty cycle 派发前「现读」团队配置组装。
 * 现读而非缓存：用户中途改 mode/黑名单/关注/agent 配置，下一个 cycle 立即生效（常驻的优势）。
 * 复用 mesh-collaboration 同款配置读取（team config + 风控 + live + registry）。
 */
import { getTeamConfig } from './mesh-team-config'
import { getRiskRules } from './mesh-risk-store'
import { getLiveConfig } from './mesh-live-backend'
import { listAgents, getAgent } from './mesh-agent-store'
import type { MeshParticipant, TradeContext } from './mesh-runtime'

/** 现读 team config + 风控 + live，组装下单上下文（黑名单 = 风控规则 ∪ 队长拉黑）。 */
export function buildTradeContext(accountId: string): TradeContext {
  const config = getTeamConfig()
  const live = getLiveConfig()
  const stored = getRiskRules()
  return {
    mode: config.mode,
    rules: { ...stored, blacklist: Array.from(new Set([...stored.blacklist, ...config.blacklist])) },
    accountId,
    tradeMode: live.tradeMode,
    liveEnabled: live.liveEnabled,
  }
}

/** topic → 订阅它的 enabled agent（队长不在协作链）。每 cycle 现算，topics 改了立即生效。 */
export function buildSubscribersOf(): (topic: string) => string[] {
  const agents = listAgents({ enabled: true }).filter((a) => a.role !== 'leader')
  return (topic) => agents.filter((a) => a.topics.includes(topic)).map((a) => a.id)
}

/** 按 id 组装 MeshParticipant（停用/不存在返回 null，调度器据此跳过）。 */
export function buildParticipant(agentId: string): MeshParticipant | null {
  const a = getAgent(agentId)
  if (!a || !a.enabled) return null
  return { agent: a, topics: a.topics }
}

export function getSessionFocus(): string {
  return getTeamConfig().focus
}

/** agent 主动循环间隔（秒→毫秒）；缺省 60s。现读 registry，用户改 interval 下次排程生效。 */
export function getAgentIntervalMs(agentId: string): number {
  return (getAgent(agentId)?.interval ?? 60) * 1000
}
