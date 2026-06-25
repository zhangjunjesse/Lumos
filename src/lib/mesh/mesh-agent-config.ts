/**
 * 网状 agent 协作运行时 —— agent 配置契约。
 *
 * 这是 mesh 子系统自己的 agent 契约，刻意独立于 workflow 的 agent 绑定类型：
 * mesh agent 的能力边界由 MCP 白名单 + 工具白名单显式声明，执行器据此做硬隔离。
 *
 * 设计依据：docs/agent-mesh-collaboration-design.md §0.5 / §6
 */
import type { MCPServerConfig } from '@/types'
import { SELECTABLE_ROLES } from './mesh-constants'
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

/** 供 UI 列出「可授给某个 agent」的 MCP server（name + 描述）。下单类从不在注册表里。 */
export function listMeshMcpServers(): { name: string; description: string }[] {
  return Object.entries(getMeshMcpRegistry()).map(([name, cfg]) => ({
    name,
    description: cfg.description ?? name,
  }))
}

/** M1 示例：一个只读盯盘 agent，只能看行情/持仓，碰不到任何写/下单能力。 */
export const EXAMPLE_OBSERVE_AGENT: MeshAgentConfig = {
  id: 'observe.market',
  role: 'observe',
  systemPrompt: '你是盯盘观察 agent，只读行情与持仓，发现异动写入结论。不下单。',
  mcpAllowlist: ['qmt-readonly'],
  toolAllowlist: ['Read', 'Grep', 'Glob'],
}
