/**
 * 网状执行器的工具裁决 —— M1 安全核心。
 *
 * 与 workflow 执行器的关键区别：这里的 canUseTool 真正生效（执行器用 permissionMode:'default'
 * 并把它传给 SDK），按 agent 白名单对每一次工具调用做硬裁决。白名单外一律 deny。
 * 下单类工具的 server 永不进白名单，因此 LLM 物理上够不到下单接口。
 *
 * 设计依据：docs/agent-mesh-collaboration-design.md §6
 */
import type { CanUseTool, McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { MCPServerConfig } from '@/types'
import { toSdkMcpConfig } from '@/lib/mcp-resolver'
import { MESH_MCP_REGISTRY, type MeshAgentConfig } from './mesh-agent-config'

const MCP_TOOL_PREFIX = 'mcp__'

/** MCP 工具名形如 `mcp__<server>__<tool>`；取出 <server>，非 MCP 工具返回 null。 */
export function parseMcpServerName(toolName: string): string | null {
  if (!toolName.startsWith(MCP_TOOL_PREFIX)) return null
  const rest = toolName.slice(MCP_TOOL_PREFIX.length)
  const sep = rest.indexOf('__')
  return sep === -1 ? rest : rest.slice(0, sep)
}

/** 判定某工具是否在该 agent 的白名单内。 */
export function isToolAllowed(agent: MeshAgentConfig, toolName: string): boolean {
  const server = parseMcpServerName(toolName)
  if (server !== null) {
    return agent.mcpAllowlist.includes(server)
  }
  return agent.toolAllowlist.includes(toolName)
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
  const selected: Record<string, MCPServerConfig> = {}
  for (const name of allowlist) {
    const cfg = MESH_MCP_REGISTRY[name]
    if (cfg) selected[name] = cfg
  }
  return toSdkMcpConfig(selected)
}
