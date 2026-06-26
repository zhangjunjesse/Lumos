/**
 * 网状协作的共享类型契约 —— 旧的"整轮编排（runCollaborationOnce）+ action-plan 单事务执行"运行时已删除。
 * agent 现在 turn 内直接调注入的工具产生副作用（协作见 mesh-collab、下单见 mesh-trade），
 * 框架不再收集 action plan 再统一执行。这里只留下被各处复用的两个类型：
 * - MeshParticipant：一个 agent + 它订阅的 topics（调度/订阅关系用）
 * - TradeContext：下单上下文（模式 / 风控规则 / 账户 / 真盘开关），由 duty cycle 现读团队配置组装
 */
import type { RiskRules } from './mesh-risk-rules'
import type { MeshAgentConfig } from './mesh-agent-config'

export interface MeshParticipant {
  agent: MeshAgentConfig
  topics: string[]
}

export interface TradeContext {
  mode: 'auto' | 'observe_only'
  rules?: RiskRules
  accountId: string
  tradeMode: 'paper' | 'live'
  liveEnabled: boolean
}
