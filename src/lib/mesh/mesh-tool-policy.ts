/**
 * 网状执行器的工具裁决 —— M1 安全核心。
 *
 * 与 workflow 执行器的关键区别：这里的 canUseTool 真正生效（permissionMode:'default'）。
 * 工具策略（用户选择「全放开」）：内置工具一律放开；MCP 工具仍按 agent.mcpAllowlist 裁决
 * （mcpAllowlist = 注入清单，未注入的 MCP server 一律 deny）。
 * 下单安全不靠工具白名单——下单走确定性 OrderGateway，从不注册下单类 MCP server，
 * 因此 LLM 物理上够不到下单接口（这才是真正的硬隔离）。
 *
 * 设计依据：docs/agent-mesh-collaboration-design.md §6
 */
import type { CanUseTool, McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { MCPServerConfig } from '@/types'
import { toSdkMcpConfig } from '@/lib/mcp-resolver'
import { getMeshMcpRegistry, type MeshAgentConfig } from './mesh-agent-config'

const MCP_TOOL_PREFIX = 'mcp__'

/** 全放开:预批准给 SDK 的内置工具集,让 agent 确知可用、不再误判"没工具"。 */
export const MESH_BUILTIN_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'NotebookEdit', 'Task', 'ToolSearch']

/** MCP 工具名形如 `mcp__<server>__<tool>`；取出 <server>，非 MCP 工具返回 null。 */
export function parseMcpServerName(toolName: string): string | null {
  if (!toolName.startsWith(MCP_TOOL_PREFIX)) return null
  const rest = toolName.slice(MCP_TOOL_PREFIX.length)
  const sep = rest.indexOf('__')
  return sep === -1 ? rest : rest.slice(0, sep)
}

/** 判定某工具是否可用。内置工具全放开;框架级 mesh-collab 人人可用;其余 MCP 按 mcpAllowlist(= 注入清单)。 */
export function isToolAllowed(agent: MeshAgentConfig, toolName: string): boolean {
  const server = parseMcpServerName(toolName)
  // mesh-collab = 框架自带的通用协作工具(读写黑板/发事件/派任务/回执),所有 agent 都可用,不需进 mcpAllowlist。
  if (server === 'mesh-collab') return true
  // 其余 MCP 工具:仍按 mcpAllowlist。未注入的 server(含下单类,从不注册)一律拒。
  if (server !== null) return agent.mcpAllowlist.includes(server)
  // 内置工具:全放开。下单不靠工具白名单防,靠 OrderGateway 结构隔离(无下单工具)。
  return true
}

/**
 * 构造该 agent 的 canUseTool。命中白名单 allow（原样放行 input），否则 deny（带 message）。
 * 这是 LLM 与危险能力之间的硬闸。
 */
export function createMeshCanUseTool(agent: MeshAgentConfig): CanUseTool {
  return async (toolName, input) => {
    if (isToolAllowed(agent, toolName)) {
      return { behavior: 'allow', updatedInput: input }
    }
    return {
      behavior: 'deny',
      message: `mesh-worker: tool "${toolName}" not in allowlist for agent "${agent.id}"`,
    }
  }
}

/**
 * 从网状专属注册表里，只挑该 agent 白名单内的 MCP，转成 SDK 配置。
 * 不走 resolveEnabledMcpServers / 全局 DB —— 那条路只认 is_enabled，且会让 workflow 看到这些 server。
 * 白名单里尚未注册的 server（如未实现的 mesh-collab）安全跳过。
 */
export function resolveMeshMcpServers(allowlist: string[]): Record<string, McpServerConfig> {
  if (allowlist.length === 0) return {} // 无 MCP 的 agent 不必构建注册表（省去读 qmt 设置的 DB 查询）
  const registry = getMeshMcpRegistry()
  const selected: Record<string, MCPServerConfig> = {}
  for (const name of allowlist) {
    const cfg = registry[name]
    if (cfg) selected[name] = cfg
  }
  return toSdkMcpConfig(selected)
}
