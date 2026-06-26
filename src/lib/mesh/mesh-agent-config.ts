/**
 * 网状 agent 协作运行时 —— agent 配置契约。
 *
 * 这是 mesh 子系统自己的 agent 契约，刻意独立于 workflow 的 agent 绑定类型：
 * mesh agent 的能力边界由 MCP 白名单 + 工具白名单显式声明，执行器据此做硬隔离。
 *
 * 设计依据：docs/agent-mesh-collaboration-design.md §0.5 / §6
 */
import type { MCPServerConfig } from '@/types'
import { SELECTABLE_ROLES, MESH_TRADE_MCP_SERVER_NAME } from './mesh-constants'
import { resolveQmtPython, resolveQmtScript, resolveQmtEnv } from '@/lib/qmt-runtime'

/** mesh agent 角色。可选角色见 mesh-constants.SELECTABLE_ROLES(单一真源);leader=团队唯一管理者,不可被用户新建。 */
export type MeshAgentRole = (typeof SELECTABLE_ROLES)[number] | 'leader'

/** agent 工作模式：active_loop=按 interval 主动醒来干活；event_driven=只被事件/定向任务唤醒。 */
export type MeshWorkMode = 'active_loop' | 'event_driven'

/**
 * 网状 agent 配置。能力边界靠 mcpAllowlist + toolAllowlist 显式声明——
 * 不在白名单里的工具，执行器一律拒绝（见 mesh-tool-policy）。
 */
export interface MeshAgentConfig {
  id: string
  role: MeshAgentRole
  systemPrompt: string
  /** 解析后的模型 id；留空时由 provider 默认模型决定。 */
  model?: string
  /** 该 agent 用哪个服务商(api_providers.id);留空走默认服务商。 */
  providerId?: string
  /** 允许注入的 MCP server 名单（如 'qmt-readonly'）。 */
  mcpAllowlist: string[]
  /** 允许的内置工具名单（如 'Read'/'Grep'）；下单等危险能力永不在此。 */
  toolAllowlist: string[]
}

/**
 * 网状专属 MCP 注册表 —— 每次调用按当前 DB 设置重建（路径/python 在 UI 改后下一轮即生效）。
 * qmt 的 python/脚本/env 解析复用 @/lib/qmt-runtime（与全局 MCP 插件页同一份真源）。
 * 注：qmt-readonly 现在也作为全局内置 MCP 注册（public/mcp-servers/qmt-readonly.json，默认关闭），
 * 但下单类能力永不进任何注册表——危险动作只走 OrderGateway。
 */
export function getMeshMcpRegistry(): Record<string, MCPServerConfig> {
  return {
    'qmt-readonly': {
      command: resolveQmtPython(),
      args: [resolveQmtScript()],
      env: resolveQmtEnv(),
      type: 'stdio',
      runtime: 'python',
      description: 'QMT 行情/账户只读 MCP（无下单）',
      scope: 'builtin',
    },
  }
}

export interface MeshMcpOption {
  name: string
  description: string
  /** 框架自带的 in-process 能力（如下单 mesh-trade）：执行器直接注入、无 stdio 连接，故 UI 不提供「测试连接」。 */
  builtin?: boolean
}

/**
 * 供 UI / 管家列出「可授给某个 agent」的能力：
 * - 注册表里的 stdio MCP（qmt-readonly 等行情/数据，按 mcpAllowlist 注入、可测连接）
 * - 框架自带的 opt-in 能力：mesh-trade 下单（只有授了的 agent 才注入，经确定性风控总闸 + OrderGateway）
 * mesh-collab 协作工具人人自带、不需授权，故不在此列。
 */
export function listMeshMcpServers(): MeshMcpOption[] {
  const registry: MeshMcpOption[] = Object.entries(getMeshMcpRegistry()).map(([name, cfg]) => ({
    name,
    description: cfg.description ?? name,
  }))
  registry.push({
    name: MESH_TRADE_MCP_SERVER_NAME,
    description: '下单（买/卖，经确定性风控总闸 + OrderGateway 撮合）。默认模拟盘；真盘须在工作室「运行 & 实盘」开关并输确认词。授给谁，谁就能下单。',
    builtin: true,
  })
  return registry
}
