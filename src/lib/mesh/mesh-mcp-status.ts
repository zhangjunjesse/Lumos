/**
 * 每 agent 最近一次运行时的 MCP 连接状态（来自 SDK 启动 init 消息的 mcp_servers）。
 * 终结"黑盒静默失败"：agent 跑一轮就落库，UI 据此显示 已连/失败,不用再去敲命令排查。
 */
import { getDb } from '@/lib/db/connection'

export interface McpServerStatus {
  name: string
  /** 'connected' | 'failed' | 'pending' | 'needs-auth' …（SDK 原样给的字符串） */
  status: string
}

export function saveMcpStatus(workshopId: string, agentId: string, status: McpServerStatus[]): void {
  getDb()
    .prepare(
      `INSERT INTO mesh_mcp_status (workshop_id, agent_id, status_json, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(workshop_id, agent_id) DO UPDATE SET status_json = excluded.status_json, updated_at = datetime('now')`,
    )
    .run(workshopId, agentId, JSON.stringify(status))
}

export function getMcpStatus(workshopId: string, agentId: string): McpServerStatus[] {
  const row = getDb()
    .prepare('SELECT status_json FROM mesh_mcp_status WHERE workshop_id = ? AND agent_id = ?')
    .get(workshopId, agentId) as { status_json: string } | undefined
  if (!row) return []
  try {
    const arr = JSON.parse(row.status_json)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}
