/**
 * 团队管家动作 —— 用户自然语言被「管家」agent 拆成这些对成员(agent)的结构化增删改,
 * 再由确定性代码应用到 agent registry。动作是白名单,只动团队结构,碰不到下单。
 */
import { SELECTABLE_ROLES } from './mesh-constants'

/** 角色取值单一真源（与 UI、MeshAgentRole 同源，避免漂移）。 */
export const TEAM_ROLES = SELECTABLE_ROLES
export type TeamWorkMode = 'active_loop' | 'event_driven'

export interface AgentFields {
  role?: string
  systemPrompt?: string
  model?: string
  workMode?: TeamWorkMode
  interval?: number
  topics?: string[]
  mcpAllowlist?: string[]
  enabled?: boolean
}
export interface CreateAgentAction extends AgentFields {
  type: 'create_agent'
  id: string
}
export interface UpdateAgentAction extends AgentFields {
  type: 'update_agent'
  id: string
}
export interface DeleteAgentAction {
  type: 'delete_agent'
  id: string
}
export type TeamAction = CreateAgentAction | UpdateAgentAction | DeleteAgentAction

export interface TeamAssistantResult {
  reply: string
  actions: TeamAction[]
}

/** 管家的 SDK 结构化输出 schema。 */
export function buildTeamAssistantSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['reply', 'actions'],
    properties: {
      reply: { type: 'string' },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'id'],
          properties: {
            type: { type: 'string', enum: ['create_agent', 'update_agent', 'delete_agent'] },
            id: { type: 'string' },
            role: { type: 'string', enum: TEAM_ROLES },
            systemPrompt: { type: 'string' },
            model: { type: 'string' },
            workMode: { type: 'string', enum: ['active_loop', 'event_driven'] },
            interval: { type: 'number' },
            topics: { type: 'array', items: { type: 'string' } },
            mcpAllowlist: { type: 'array', items: { type: 'string' } },
            enabled: { type: 'boolean' },
          },
        },
      },
    },
  }
}

export function parseTeamAssistantResult(raw: unknown): TeamAssistantResult {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const reply = typeof o.reply === 'string' ? o.reply : ''
  const rawActions = Array.isArray(o.actions) ? o.actions : []
  const actions: TeamAction[] = []
  for (const a of rawActions) {
    const action = normalizeAction(a)
    if (action) actions.push(action)
  }
  return { reply, actions }
}

function normalizeAction(a: unknown): TeamAction | null {
  if (!a || typeof a !== 'object') return null
  const o = a as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim().replace(/\s+/g, '-') : '' // 空白→连字符,保 @ 提及可用
  if (!id) return null
  if (o.type === 'delete_agent') return { type: 'delete_agent', id }
  if (o.type !== 'create_agent' && o.type !== 'update_agent') return null
  return { type: o.type, id, ...pickFields(o) }
}

// 口语模型名 → 真实 model id（用户/LLM 常写 "opus",得映射否则运行时认不出）。全 id 原样透传。
const MODEL_ALIASES: Record<string, string> = {
  opus: 'claude-opus-4-8',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
}
function normalizeModel(raw: string): string {
  const m = raw.trim()
  return MODEL_ALIASES[m.toLowerCase()] ?? m
}

function pickFields(o: Record<string, unknown>): AgentFields {
  const f: AgentFields = {}
  if (typeof o.role === 'string' && (TEAM_ROLES as readonly string[]).includes(o.role)) f.role = o.role
  if (typeof o.systemPrompt === 'string') f.systemPrompt = o.systemPrompt
  if (typeof o.model === 'string' && o.model.trim()) f.model = normalizeModel(o.model)
  if (o.workMode === 'active_loop' || o.workMode === 'event_driven') f.workMode = o.workMode
  if (typeof o.interval === 'number' && Number.isFinite(o.interval)) f.interval = Math.max(5, Math.round(o.interval))
  if (Array.isArray(o.topics)) f.topics = o.topics.map(String).filter(Boolean)
  if (Array.isArray(o.mcpAllowlist)) f.mcpAllowlist = o.mcpAllowlist.map(String).filter(Boolean)
  if (typeof o.enabled === 'boolean') f.enabled = o.enabled
  return f
}
