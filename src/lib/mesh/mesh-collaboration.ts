/**
 * 炒股协作编排：盯盘 → 决策(提议) → 风控审议 → OrderGateway paper 成交 → 复盘归因。
 * 跑前读 team config（Leader/Control Plane 改的）：黑名单并进 Risk Gate、focus 进盯盘、mode 控制是否下单。
 * 行情用传入快照驱动（不连 qmt）；白板/事件/全部 agent 都是真的。
 */
import {
  runCollaborationOnce,
  type CollaborationResult,
  type MeshParticipant,
} from './mesh-runtime'
import {
  STOCK_WATCH_AGENT,
  STOCK_DECIDE_AGENT,
  STOCK_RISK_AGENT,
  STOCK_REVIEW_AGENT,
} from './mesh-stock-agents'
import { getTeamConfig } from './mesh-team-config'
import { getRiskRules } from './mesh-risk-store'
import { getLiveConfig } from './mesh-live-backend'

/** 单向收敛链：盯盘→[quote_anomaly]→决策→[order_proposal]→风控→(order_intent)→成交；复盘 drain 后跑。 */
export function buildStockParticipants(): MeshParticipant[] {
  return [
    { agent: STOCK_WATCH_AGENT, topics: [] },
    { agent: STOCK_DECIDE_AGENT, topics: ['quote_anomaly'] },
    { agent: STOCK_RISK_AGENT, topics: ['order_proposal'] },
    { agent: STOCK_REVIEW_AGENT, topics: [] },
  ]
}

export function runStockCollaboration(
  snapshot: unknown,
  options: { sessionId?: string; accountId?: string; abortController?: AbortController } = {},
): Promise<CollaborationResult> {
  const config = getTeamConfig()
  const live = getLiveConfig()
  const stored = getRiskRules()
  const riskRules = {
    ...stored,
    blacklist: Array.from(new Set([...stored.blacklist, ...config.blacklist])),
  }
  return runCollaborationOnce(
    buildStockParticipants(),
    {
      snapshotKey: 'market_snapshot',
      snapshot,
      starterId: STOCK_WATCH_AGENT.id,
      reviewerId: STOCK_REVIEW_AGENT.id,
      riskRules,
      mode: config.mode,
      focus: config.focus,
      accountId: options.accountId,
      tradeMode: live.tradeMode,
      liveEnabled: live.liveEnabled,
    },
    { sessionId: options.sessionId, abortController: options.abortController },
  )
}
