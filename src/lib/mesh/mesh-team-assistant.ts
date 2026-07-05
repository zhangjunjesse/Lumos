/**
 * 团队管家（管理面）+ 确定性应用面。按 workshopId 隔离。
 * - runTeamAssistant：把用户自然语言拆成对成员的结构化动作（LLM）。
 * - applyTeamActions：确定性应用——建/改直接执行(低风险可撤)，删除只回 pending 交 UI 二次确认。
 * 管家只产动作意图,改 registry 由这层确定性代码做;碰不到下单(OrderGateway 结构隔离)。
 */
import { runMeshAgentStructured } from './mesh-worker'
import { listAgents, getAgent, upsertAgent, agentExists, type StoredAgent } from './mesh-agent-store'
import { listMeshMcpServers } from './mesh-agent-config'
import { getAssistantSettings } from './mesh-settings-store'
import { DEFAULT_WORKSHOP_ID } from './mesh-constants'
import {
  buildTeamAssistantSchema,
  parseTeamAssistantResult,
  type CreateAgentAction,
  type TeamAction,
  type TeamAssistantResult,
  type UpdateAgentAction,
} from './mesh-team-action-schema'
import type { MeshAgentConfig } from './mesh-agent-config'

const ASSISTANT_AGENT: MeshAgentConfig = {
  id: 'team.assistant',
  role: 'custom',
  systemPrompt: `你是 AI 团队管家,帮用户管理这个 agent 团队的成员。把用户的自然语言要求拆成结构化动作:
- create_agent 新建成员:必给 id(英文+点号、唯一,如 team.researcher)、role(成员标签,纯展示分组用)、systemPrompt(把这个成员的职责写清楚)。可选 model、workMode(active_loop 主动循环 / event_driven 事件驱动)、interval(主动循环秒数)、topics(订阅哪些事件)、mcpAllowlist(从"可用 MCP"里选,授给它额外能力)。
- update_agent 改现有成员:给 id + 要改的字段(含 enabled 启停)。
- delete_agent 删成员:给 id。
role 只是展示用的标签,默认 custom 即可;成员的具体职责完全由 systemPrompt 决定,框架不写死。
reply 用一句话复述你做了什么。看不懂或无可执行动作时 actions 留空、reply 说明。你只产动作,不直接改库。`,
  mcpAllowlist: [],
  toolAllowlist: [],
}

/** 管家：把用户自然语言拆成结构化动作（LLM）。带上当前花名册 + 可用 MCP 供它参考。 */
export async function runTeamAssistant(
  userMessage: string,
  options: { sessionId?: string; workshopId?: string } = {},
): Promise<TeamAssistantResult> {
  const workshopId = options.workshopId ?? DEFAULT_WORKSHOP_ID
  const roster = listAgents(workshopId)
    .map((a) => `- ${a.id}（${a.role}${a.enabled ? '' : '，已停用'}）：${a.systemPrompt.slice(0, 40)}`)
    .join('\n')
  const mcp = listMeshMcpServers().map((m) => m.name).join('、') || '（无）'
  const prompt = `当前团队成员：\n${roster || '（空）'}\n\n可用 MCP 工具：${mcp}\n\n用户要求：${userMessage}\n\n据此产出对成员的增删改动作。`
  // 服务商/模型优先用「团队管家设置」里用户显式定义的;没配才回退队长配置(已配过的可用源;
  // 默认服务商常是坏的本地登录),再没有回退 sonnet:NL→JSON 解析无需 opus,sonnet 快得多
  // (实测 17s vs opus 80-120s 顶超时)。
  const saved = getAssistantSettings()
  const leader = getAgent(workshopId, 'team.leader')
  const providerId = saved.providerId || leader?.providerId
  const model = saved.model || leader?.model || 'claude-sonnet-4-6'
  const agent = { ...ASSISTANT_AGENT, providerId, model }
  // maxTurns:2——管家只需一轮出 JSON,不必给工具探索空间,杜绝多轮把慢模型拖到超时。
  const { structured } = await runMeshAgentStructured(agent, prompt, buildTeamAssistantSchema(), { sessionId: options.sessionId, maxTurns: 2 })
  return parseTeamAssistantResult(structured)
}

export interface ApplyTeamResult {
  applied: string[]
  /** 删除动作不直接执行,回这些 id 交 UI 二次确认。 */
  pendingDeletes: string[]
}

/** 确定性应用:建/改直接执行,删除只收集成 pending(UI 确认后走 DELETE /api/mesh/agents)。 */
export function applyTeamActions(actions: TeamAction[], workshopId: string = DEFAULT_WORKSHOP_ID): ApplyTeamResult {
  const applied: string[] = []
  const pendingDeletes: string[] = []
  const validMcp = new Set(listMeshMcpServers().map((m) => m.name)) // 过滤 LLM 幻觉出来的不存在 MCP
  for (const a of actions) {
    if (a.type === 'create_agent') {
      if (agentExists(workshopId, a.id)) {
        applied.push(`跳过创建 ${a.id}（同 id 已存在）`)
        continue
      }
      upsertAgent(workshopId, toPatch(a, { role: a.role ?? 'custom', enabled: a.enabled ?? true }, validMcp))
      applied.push(`已创建 ${a.id}`)
    } else if (a.type === 'update_agent') {
      if (!agentExists(workshopId, a.id)) {
        applied.push(`跳过修改 ${a.id}（不存在）`)
        continue
      }
      upsertAgent(workshopId, toPatch(a, {}, validMcp))
      applied.push(`已修改 ${a.id}`)
    } else {
      if (a.id === 'team.leader') applied.push('队长不可删')
      else if (agentExists(workshopId, a.id)) pendingDeletes.push(a.id)
      else applied.push(`跳过删除 ${a.id}（不存在）`)
    }
  }
  return { applied, pendingDeletes }
}

function toPatch(
  a: CreateAgentAction | UpdateAgentAction,
  defaults: { role?: string; enabled?: boolean },
  validMcp: Set<string>,
): Partial<StoredAgent> & { id: string } {
  const p: Partial<StoredAgent> & { id: string } = { id: a.id }
  if (a.role) p.role = a.role as StoredAgent['role']
  else if (defaults.role) p.role = defaults.role as StoredAgent['role']
  if (a.systemPrompt !== undefined) p.systemPrompt = a.systemPrompt
  if (a.model !== undefined) p.model = a.model
  if (a.workMode) p.workMode = a.workMode
  if (typeof a.interval === 'number') p.interval = a.interval
  if (a.topics) p.topics = a.topics
  if (a.mcpAllowlist) p.mcpAllowlist = a.mcpAllowlist.filter((n) => validMcp.has(n)) // 丢弃不在注册表里的幻觉 MCP
  if (typeof a.enabled === 'boolean') p.enabled = a.enabled
  else if (defaults.enabled !== undefined) p.enabled = defaults.enabled
  return p
}
