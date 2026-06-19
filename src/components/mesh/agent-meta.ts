// agent 写入者 → 展示名 + 配色，黑板和对话共用一套，避免左右两套叫法。
// 对齐 mesh-stock-agents.ts 的真实 agent id（stock.observe / stock.decide / stock.risk / stock.review）
// 与非 agent 来源（seed 初始注入 / user 用户 / system）。
export interface AgentMeta {
  name: string
  color: string
}

const AGENT_META: Record<string, AgentMeta> = {
  'team.leader': { name: '队长', color: 'bg-indigo-100 text-indigo-700' },
  'stock.observe': { name: '盯盘', color: 'bg-sky-100 text-sky-700' },
  'stock.decide': { name: '决策', color: 'bg-violet-100 text-violet-700' },
  'stock.risk': { name: '风控', color: 'bg-amber-100 text-amber-700' },
  'stock.review': { name: '复盘', color: 'bg-emerald-100 text-emerald-700' },
  seed: { name: '初始行情', color: 'bg-neutral-100 text-neutral-600' },
  user: { name: '你', color: 'bg-neutral-900 text-white' },
  'order-gateway': { name: '网关', color: 'bg-neutral-100 text-neutral-600' },
}

export function agentMeta(writtenBy: string): AgentMeta {
  return AGENT_META[writtenBy] ?? { name: writtenBy, color: 'bg-neutral-100 text-neutral-600' }
}
