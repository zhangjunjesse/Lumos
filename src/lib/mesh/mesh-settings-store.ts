/**
 * mesh 全局设置（KV，非 per-workshop）—— 目前存 qmt 数据源接入参数。
 * 拔掉 mesh-agent-config 里写死的 ~/Downloads/量化 路径：UI 可配、存 DB。
 * 优先级（在 mesh-agent-config 的 resolve* 里）：环境变量 > 这里(DB) > 内置默认。
 */
import { getDb } from '@/lib/db/connection'

export interface MeshQmtSettings {
  /** qmt_mcp_server.py 所在目录 */
  qmtDir: string
  /** python 解释器路径（Windows 需 C:\Python311\python.exe 这类绝对路径） */
  qmtPython: string
  /** QMT 客户端安装路径（userdata_mini）；空则用脚本内默认 */
  qmtPath: string
  /** QMT 账户号；空则用脚本内默认 */
  qmtAccountId: string
}

export function getMeshSetting(key: string): string {
  const row = getDb().prepare('SELECT value FROM mesh_settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? ''
}

export function setMeshSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO mesh_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    )
    .run(key, value)
}

export function getQmtSettings(): MeshQmtSettings {
  return {
    qmtDir: getMeshSetting('qmt_dir'),
    qmtPython: getMeshSetting('qmt_python'),
    qmtPath: getMeshSetting('qmt_path'),
    qmtAccountId: getMeshSetting('qmt_account_id'),
  }
}

export function setQmtSettings(patch: Partial<MeshQmtSettings>): void {
  if (patch.qmtDir !== undefined) setMeshSetting('qmt_dir', patch.qmtDir.trim())
  if (patch.qmtPython !== undefined) setMeshSetting('qmt_python', patch.qmtPython.trim())
  if (patch.qmtPath !== undefined) setMeshSetting('qmt_path', patch.qmtPath.trim())
  if (patch.qmtAccountId !== undefined) setMeshSetting('qmt_account_id', patch.qmtAccountId.trim())
}
