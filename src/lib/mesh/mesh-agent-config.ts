/**
 * 网状 agent 协作运行时 —— agent 配置契约。
 *
 * 这是 mesh 子系统自己的 agent 契约，刻意独立于 workflow 的 agent 绑定类型：
 * mesh agent 的能力边界由 MCP 白名单 + 工具白名单显式声明，执行器据此做硬隔离。
 *
 * 设计依据：docs/agent-mesh-collaboration-design.md §0.5 / §6
 */
import os from 'os'
import path from 'path'
import type { MCPServerConfig } from '@/types'

/** mesh agent 角色。 */
export type MeshAgentRole =
  | 'observe'
  | 'decide'
  | 'risk'
  | 'execute'
  | 'leader'
  | 'research'
  | 'review'

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
  /** 允许注入的 MCP server 名单（如 'qmt-readonly'）。 */
  mcpAllowlist: string[]
  /** 允许的内置工具名单（如 'Read'/'Grep'）；下单等危险能力永不在此。 */
  toolAllowlist: string[]
}

function resolveQmtDir(): string {
  return process.env.LUMOS_QMT_DIR?.trim() || path.join(os.homedir(), 'Downloads', '量化')
}

function resolveQmtPython(): string {
  if (process.env.LUMOS_QMT_PYTHON?.trim()) return process.env.LUMOS_QMT_PYTHON.trim()
  // Lumos 会把内置 venv 前置进 SDK 子进程的 PATH，裸 'python' 会被劫持到没有 xtquant 的
  // venv，导致 qmt MCP 一 import xtquant 就崩。Windows 实测解释器在 C:\Python311（装了
  // xtquant），用绝对路径绕开劫持；非 win 开发机保持 'python'，可被 LUMOS_QMT_PYTHON 覆盖。
  if (process.platform === 'win32') return 'C:\\Python311\\python.exe'
  return 'python'
}

/**
 * 网状专属 MCP 注册表 —— 刻意不进 DB、不进全局 isEnabled。
 * 这样 workflow 的全量 MCP 注入物理上看不到这些 server，实现双向隔离。
 * 执行器只从这里按 agent 白名单挑选注入。
 */
export const MESH_MCP_REGISTRY: Record<string, MCPServerConfig> = {
  'qmt-readonly': {
    command: resolveQmtPython(),
    args: [path.join(resolveQmtDir(), 'qmt_mcp_server.py')],
    env: {
      ...(process.env.QMT_PATH ? { QMT_PATH: process.env.QMT_PATH } : {}),
      ...(process.env.QMT_ACCOUNT_ID ? { QMT_ACCOUNT_ID: process.env.QMT_ACCOUNT_ID } : {}),
    },
    type: 'stdio',
    runtime: 'python',
    description: 'QMT 行情/账户只读 MCP（无下单）',
    scope: 'builtin',
  },
}

/** M1 示例：一个只读盯盘 agent，只能看行情/持仓，碰不到任何写/下单能力。 */
export const EXAMPLE_OBSERVE_AGENT: MeshAgentConfig = {
  id: 'observe.market',
  role: 'observe',
  systemPrompt: '你是盯盘观察 agent，只读行情与持仓，发现异动写入结论。不下单。',
  mcpAllowlist: ['qmt-readonly'],
  toolAllowlist: ['Read', 'Grep', 'Glob'],
}
