/**
 * 工作室生命周期 service —— 删工作室 = 全删干净（用户定）。
 * 守 CLAUDE.md 生命周期铁律：不把删 UI 记录当停止执行；集中在一处，route 只调一次。
 * 顺序：先停 runner（清 timer + abort 在飞 duty cycle + 终态 mesh_run），再级联删配置 + 运行历史 + workshop 行。
 */
import { getDb } from '@/lib/db/connection'
import { stopMonitoring } from './mesh-run-control'
import { deleteWorkshopRow } from './mesh-workshop-store'

export async function deleteWorkshop(workshopId: string): Promise<void> {
  const stopped = await stopMonitoring(workshopId) // 先停 runner（事务外：含 AbortController 中断在飞 SDK）
  if (!stopped.ok && stopped.reason !== '该账户未在盯盘') {
    throw new Error(stopped.reason ?? '工作室正在运行，停止失败')
  }

  const db = getDb()
  db.transaction(() => {
    // 运行历史：该工作室所有 session 的常驻 runId（mesh_run.last_run_id）派生数据
    const runIds = (
      db.prepare('SELECT last_run_id FROM mesh_run WHERE account_id = ? AND last_run_id IS NOT NULL').all(workshopId) as { last_run_id: string }[]
    ).map((r) => r.last_run_id)
    for (const rid of runIds) {
      db.prepare('DELETE FROM mesh_message_delivery WHERE message_id IN (SELECT id FROM mesh_message WHERE run_id = ?)').run(rid)
      db.prepare('DELETE FROM mesh_message WHERE run_id = ?').run(rid)
      db.prepare('DELETE FROM mesh_blackboard WHERE run_id = ?').run(rid)
      db.prepare('DELETE FROM mesh_participant WHERE run_id = ?').run(rid)
      db.prepare('DELETE FROM mesh_order_ticket WHERE run_id = ?').run(rid)
    }
    db.prepare('DELETE FROM mesh_paper_account WHERE run_id = ?').run(workshopId) // 账户按 workshopId（initAccount(accountId)）
    db.prepare('DELETE FROM mesh_run WHERE account_id = ?').run(workshopId)

    // 配置层（按 workshop_id 隔离）
    db.prepare('DELETE FROM mesh_agent WHERE workshop_id = ?').run(workshopId)
    db.prepare('DELETE FROM mesh_team_config WHERE workshop_id = ?').run(workshopId)
    db.prepare('DELETE FROM mesh_risk_rules WHERE workshop_id = ?').run(workshopId)
    db.prepare('DELETE FROM mesh_command WHERE workshop_id = ?').run(workshopId)

    deleteWorkshopRow(workshopId)
  })()
}
