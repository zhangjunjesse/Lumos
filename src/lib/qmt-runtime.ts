/**
 * qmt 只读 MCP 的运行时解析 —— python 解释器 / 脚本路径 / QMT 接入 env。
 *
 * 单一真源：炒股团队(mesh)和全局 MCP 插件页都从这里取，避免两处漂移。
 * 优先级：环境变量 > DB 设置(mesh_settings，UI 可配) > 随安装包的内置默认 > 回落用户目录。
 */
import os from 'os'
import path from 'path'
import { getMeshSetting } from '@/lib/mesh/mesh-settings-store'
import { resolveRuntimeResourcePath } from '@/lib/runtime-resources'

// qmt 脚本目录：env > DB 设置(UI 可配) > 随安装包的内置脚本 > 回落用户目录。
// 默认走内置(resources/mcp-servers/qmt-readonly)：更新 Lumos 即更新脚本，用户无需手动同步。
export function resolveQmtDir(): string {
  const configured = process.env.LUMOS_QMT_DIR?.trim() || getMeshSetting('qmt_dir')
  if (configured) return configured
  const bundled = resolveRuntimeResourcePath(path.join('mcp-servers', 'qmt-readonly', 'qmt_mcp_server.py'))
  return bundled ? path.dirname(bundled) : path.join(os.homedir(), 'Downloads', '量化')
}

/** qmt_mcp_server.py 的完整路径（脚本目录 + 文件名，按平台正确拼接）。 */
export function resolveQmtScript(): string {
  return path.join(resolveQmtDir(), 'qmt_mcp_server.py')
}

export function resolveQmtPython(): string {
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
export function resolveQmtEnv(): Record<string, string> {
  const qmtPath = process.env.QMT_PATH || getMeshSetting('qmt_path')
  const accountId = process.env.QMT_ACCOUNT_ID || getMeshSetting('qmt_account_id')
  return {
    ...(qmtPath ? { QMT_PATH: qmtPath } : {}),
    ...(accountId ? { QMT_ACCOUNT_ID: accountId } : {}),
  }
}
