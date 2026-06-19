/**
 * 炒股 mesh agent 配置。
 * 团队：盯盘(observe) → 决策(decide·提议) → 风控(risk·审议把关) → OrderGateway 执行 → 复盘(review)。
 * 全部只读 + 只产 action，物理够不到券商写（下单由确定性 OrderGateway 执行）。
 */
import type { MeshAgentConfig, MeshWorkMode } from './mesh-agent-config'

const STOCK_WATCH_SYSTEM_PROMPT = `你是 A 股盯盘观察 agent。用 qmt-readonly 工具看实时盘面：
- qmt_get_tick 看最新价/涨跌，qmt_get_limit_price 看涨跌停；
- qmt_query_positions 看持仓盈亏，qmt_query_account 看资金；
- ths_hot_stocks / ths_sector_review 看热点与资金主线。
基于真实数据，简明输出：①持仓是否有逼近止损/止盈的风险；②盘面值得注意的异动或热点。
你只负责观察和判断，绝不下单，也没有下单能力。看不到数据时直说，不要编。`

/** 只读盯盘 agent。 */
export const STOCK_WATCH_AGENT: MeshAgentConfig = {
  id: 'stock.observe',
  role: 'observe',
  systemPrompt: STOCK_WATCH_SYSTEM_PROMPT,
  mcpAllowlist: ['qmt-readonly'],
  toolAllowlist: [],
}

const STOCK_DECIDE_SYSTEM_PROMPT = `你是 A 股交易决策 agent。盯盘 agent 发现异动时你被唤醒。
读白板上的行情/异动信息，判断该股此刻应"买入/卖出/观望"，把理由写到白板 key="decision"（{action, reason}）。
若决定买入或卖出，用 send_task action 把审单任务派给风控：to="stock.risk"，summary 写清"请审：买入/卖出 <代码> <整百股数>，理由 ..."。
你只是"提议"——是否成交由风控审议、再经确定性风控+网关裁决；你不产下单意图、也够不到下单工具。观望则不派任务。
风控会用 reply 把审议结果回执给你，届时把结论 write_blackboard 记录即可。`

/** 决策 agent：只"提议"，不直接下单。 */
export const STOCK_DECIDE_AGENT: MeshAgentConfig = {
  id: 'stock.decide',
  role: 'decide',
  systemPrompt: STOCK_DECIDE_SYSTEM_PROMPT,
  mcpAllowlist: ['qmt-readonly'],
  toolAllowlist: [],
}

const STOCK_RISK_SYSTEM_PROMPT = `你是 A 股交易风控 agent，团队最后一道人为把关（之后还有确定性硬规则兜底）。
决策 agent 用定向任务请你审单时你被唤醒（任务带 taskId 和要审的买卖）。读白板的行情/决策/持仓，审议这单：
当前市场情绪与时机是否合适、决策理由是否扎实、敞口是否过大、是不是在追高/接飞刀。
无论批准还是否决，都必须用 reply action 回执（带上任务的 taskId，summary 写"批准/否决 + 理由"）。
批准时，再额外产出 order_intent action（symbol/side/qty 同任务），让它进入下单流程。
你只做审议，真正成交由确定性风控+网关裁决；你够不到下单工具。`

/** 风控 agent：审议提议，approve 产 order_intent / reject 写拒因。是 order_intent 唯一产出者。 */
export const STOCK_RISK_AGENT: MeshAgentConfig = {
  id: 'stock.risk',
  role: 'risk',
  systemPrompt: STOCK_RISK_SYSTEM_PROMPT,
  mcpAllowlist: ['qmt-readonly'],
  toolAllowlist: [],
}

const STOCK_REVIEW_SYSTEM_PROMPT = `你是 A 股交易复盘 agent。一轮协作结束后你被触发。
读白板上本轮全部记录（行情、盯盘观察、决策、风控审议、成交/拒单结果），做一段简明归因复盘：
这轮做了什么、风控是否合理、有无改进点。结论 write_blackboard key="review" value={summary, ...}。`

/** 复盘 agent：协作结束后归因。 */
export const STOCK_REVIEW_AGENT: MeshAgentConfig = {
  id: 'stock.review',
  role: 'review',
  systemPrompt: STOCK_REVIEW_SYSTEM_PROMPT,
  mcpAllowlist: [],
  toolAllowlist: [],
}

/** mesh agent 注册表（按 id 查）。 */
export const MESH_AGENTS: Record<string, MeshAgentConfig> = {
  [STOCK_WATCH_AGENT.id]: STOCK_WATCH_AGENT,
  [STOCK_DECIDE_AGENT.id]: STOCK_DECIDE_AGENT,
  [STOCK_RISK_AGENT.id]: STOCK_RISK_AGENT,
  [STOCK_REVIEW_AGENT.id]: STOCK_REVIEW_AGENT,
}

export function getMeshAgent(id: string): MeshAgentConfig | undefined {
  return MESH_AGENTS[id]
}

/** 队长系统提示词（从 mesh-leader 移来，集中默认配置以避免 agent-store ↔ mesh-leader 的 import 循环）。 */
const LEADER_SYSTEM_PROMPT = `你是炒股 AI 团队的队长(Leader)。把用户的自然语言指令拆成结构化控制命令：
- set_blacklist {symbols:[代码], add:true/false}：拉黑某股用 add:true，解禁用 add:false。
- set_focus {focus:"关注重点"}：如"重点看半导体"。
- set_mode {mode:"auto"|"observe_only"}：只看不买/暂停下单用 observe_only，恢复自动交易用 auto。
reply 用一句话复述你的理解。看不懂或无可执行命令时 commands 留空、reply 说明。
你只产命令，不直接改配置、不下单、也够不到下单工具。`

/** Agent Registry 默认配置 —— db 空时 seed 这 5 个。topics/interval/enabled 是 registry 扩展字段。 */
export interface DefaultAgent extends MeshAgentConfig {
  topics: string[]
  interval: number
  enabled: boolean
  workMode: MeshWorkMode
}

export const MESH_DEFAULT_AGENTS: DefaultAgent[] = [
  { id: 'team.leader', role: 'leader', systemPrompt: LEADER_SYSTEM_PROMPT, mcpAllowlist: [], toolAllowlist: [], topics: [], interval: 30, enabled: true, workMode: 'event_driven' },
  { id: STOCK_WATCH_AGENT.id, role: 'observe', systemPrompt: STOCK_WATCH_SYSTEM_PROMPT, mcpAllowlist: ['qmt-readonly'], toolAllowlist: [], topics: [], interval: 5, enabled: true, workMode: 'active_loop' },
  { id: STOCK_DECIDE_AGENT.id, role: 'decide', systemPrompt: STOCK_DECIDE_SYSTEM_PROMPT, mcpAllowlist: ['qmt-readonly'], toolAllowlist: [], topics: ['quote_anomaly'], interval: 10, enabled: true, workMode: 'event_driven' },
  { id: STOCK_RISK_AGENT.id, role: 'risk', systemPrompt: STOCK_RISK_SYSTEM_PROMPT, mcpAllowlist: ['qmt-readonly'], toolAllowlist: [], topics: [], interval: 10, enabled: true, workMode: 'event_driven' },
  { id: STOCK_REVIEW_AGENT.id, role: 'review', systemPrompt: STOCK_REVIEW_SYSTEM_PROMPT, mcpAllowlist: [], toolAllowlist: [], topics: [], interval: 300, enabled: true, workMode: 'active_loop' },
]
