/**
 * 炒股协作编排：盯盘 → 决策(提议) → 风控审议 → OrderGateway paper 成交 → 复盘归因。
 * 跑前读 db：team config（Leader/设置改的）、风控规则、agent registry（团队成员配置），全按 workshopId 隔离。
 * 协作框架由 role + topics 驱动：starter=observe、reviewer=review，其余按各自 topics 订阅；停用的 agent 不进。
 * 行情用传入快照驱动（不连 qmt）；白板/事件/全部 agent 都是真的。不 import workflow / team-run。
 */
import { runCollaborationOnce, type CollaborationResult, type MeshParticipant } from './mesh-runtime'
import { listAgents } from './mesh-agent-store'
import { getTeamConfig } from './mesh-team-config'
import { getRiskRules } from './mesh-risk-store'
import { isLiveBackendConfigured } from './mesh-live-backend'
import { DEFAULT_WORKSHOP_ID } from './mesh-constants'

/** 从某工作室的 Agent Registry 读 enabled 的协作成员（排除队长——队长是指挥层，不在协作链）。 */
export function buildStockParticipants(workshopId: string): MeshParticipant[] {
  return listAgents(workshopId, { enabled: true })
    .filter((a) => a.role !== 'leader')
    .map((a) => ({ agent: a, topics: a.topics }))
}

export function runStockCollaboration(
  snapshot: unknown,
  options: { sessionId?: string; accountId?: string; abortController?: AbortController } = {},
): Promise<CollaborationResult> {
  const workshopId = options.accountId ?? DEFAULT_WORKSHOP_ID // accountId 即 workshopId
  const config = getTeamConfig(workshopId)
  const live = config.tradeMode === 'live' && isLiveBackendConfigured() // UI 开关(带确认)+ 后端就绪 才真盘
  const stored = getRiskRules(workshopId)
  const riskRules = {
    ...stored,
    blacklist: Array.from(new Set([...stored.blacklist, ...config.blacklist])),
  }

  const participants = buildStockParticipants(workshopId)
  // 协作链由 role 定位：观察者起步、复盘收尾（来自 db registry，可被启停/编辑）。
  const starterId = participants.find((p) => p.agent.role === 'observe')?.agent.id ?? participants[0]?.agent.id ?? ''
  const reviewerId = participants.find((p) => p.agent.role === 'review')?.agent.id

  return runCollaborationOnce(
    participants,
    {
      snapshotKey: 'market_snapshot',
      snapshot,
      starterId,
      reviewerId,
      riskRules,
      mode: config.mode,
      focus: config.focus,
      accountId: options.accountId,
      tradeMode: live ? 'live' : 'paper',
      liveEnabled: live,
    },
    { sessionId: options.sessionId, abortController: options.abortController },
  )
}
