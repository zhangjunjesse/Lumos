// agent 写入者 → 展示名 + 配色，黑板和对话共用一套，避免左右两套叫法。
// 框架自带的固定来源（队长 / 初始 seed / 用户 / 下单网关）有专属配色；
// 用户自建 agent 走 fallback（显示其 id），框架不写死任何业务团队成员名。
export interface AgentMeta {
  name: string
  color: string
}

const AGENT_META: Record<string, AgentMeta> = {
  'team.leader': { name: '队长', color: 'bg-indigo-100 text-indigo-700' },
  seed: { name: '初始', color: 'bg-neutral-100 text-neutral-600' },
  user: { name: '你', color: 'bg-neutral-900 text-white' },
  'order-gateway': { name: '网关', color: 'bg-neutral-100 text-neutral-600' },
}

export function agentMeta(writtenBy: string): AgentMeta {
  return AGENT_META[writtenBy] ?? { name: writtenBy, color: 'bg-neutral-100 text-neutral-600' }
}
