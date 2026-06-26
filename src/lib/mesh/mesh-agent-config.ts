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
import { getMeshSetting } from './mesh-settings-store'
import { SELECTABLE_ROLES } from './mesh-constants'
import { resolveRuntimeResourcePath } from '@/lib/runtime-resources'

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

// qmt 脚本目录:env > DB 设置(UI 可配) > 随安装包的内置脚本 > 回落用户目录。
// 默认走内置(resources/mcp-servers/qmt-readonly):更新 Lumos 即更新脚本,用户无需手动同步。
function resolveQmtDir(): string {
  const configured = process.env.LUMOS_QMT_DIR?.trim() || getMeshSetting('qmt_dir')
  if (configured) return configured
  const bundled = resolveRuntimeResourcePath(path.join('mcp-servers', 'qmt-readonly', 'qmt_mcp_server.py'))
  return bundled ? path.dirname(bundled) : path.join(os.homedir(), 'Downloads', '量化')
}

function resolveQmtPython(): string {
  if (process.env.LUMOS_QMT_PYTHON?.trim()) return process.env.LUMOS_QMT_PYTHON.trim()
  const configured = getMeshSetting('qmt_python')
  if (configured) return configured
  // Lumos 会把内置 venv 前置进 SDK 子进程的 PATH，裸 'python' 会被劫持到没有 xtquant 的
  // venv，导致 qmt MCP 一 import xtquant 就崩。Windows 实测解释器在 C:\Python311（装了
  // xtquant），用绝对路径绕开劫持；非 win 开发机保持 'python'，可被设置/LUMOS_QMT_PYTHON 覆盖。
  if (process.platform === 'win32') return 'C:\\Python311\\python.exe'
  return 'python'
}

/** QMT 安装路径 / 账户号：env > DB 设置；空则交给 python 脚本内默认。 */
function resolveQmtEnv(): Record<string, string> {
  const qmtPath = process.env.QMT_PATH || getMeshSetting('qmt_path')
  const accountId = process.env.QMT_ACCOUNT_ID || getMeshSetting('qmt_account_id')
  return {
    ...(qmtPath ? { QMT_PATH: qmtPath } : {}),
    ...(accountId ? { QMT_ACCOUNT_ID: accountId } : {}),
  }
}

/**
 * 网状专属 MCP 注册表 —— 每次调用按当前 DB 设置重建（路径/python 在 UI 改后下一轮即生效）。
 * 刻意不进全局 isEnabled，workflow 物理上看不到这些 server（双向隔离）；执行器只按 agent 白名单挑选注入。
 */
export function getMeshMcpRegistry(): Record<string, MCPServerConfig> {
  return {
    'qmt-readonly': {
      command: resolveQmtPython(),
      args: [path.join(resolveQmtDir(), 'qmt_mcp_server.py')],
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
