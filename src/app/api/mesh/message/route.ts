import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getRunningRun } from '@/lib/mesh/mesh-run'
import { getAgent } from '@/lib/mesh/mesh-agent-store'
import { persistMessage } from '@/lib/mesh/mesh-event-bus'
import { DEFAULT_WORKSHOP_ID } from '@/lib/mesh/mesh-constants'
import { ensureWorkshopExists } from '@/lib/mesh/mesh-workshop-store'

/**
 * 用户 @ 指定 agent 发定向消息。POST { to, text, accountId? } -> { ok, taskId }
 * 复用定向任务链路：写一条 agent_task 投递给目标 agent，运行中的调度器据此唤醒它处理 + 回执
 * （回执经 listAllMessages 显示在作战室消息流）。需团队在运行（有活跃 run）。
 * 业务在 lib/mesh，本 route 只解析参数 + 投递。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const to = typeof body.to === 'string' ? body.to.trim() : ''
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const workshopId = typeof body.accountId === 'string' ? body.accountId : DEFAULT_WORKSHOP_ID
    if (!to || !text) {
      return NextResponse.json({ error: 'to 和 text 必填' }, { status: 400 })
    }
    ensureWorkshopExists(workshopId)
    const agent = getAgent(workshopId, to)
    if (!agent || !agent.enabled) {
      return NextResponse.json({ error: `成员不存在或未启用：${to}` }, { status: 400 })
    }
    const run = getRunningRun(workshopId)
    if (!run?.lastRunId) {
      return NextResponse.json({ error: '团队未运行，请先启动后再 @ 成员' }, { status: 409 })
    }
    const taskId = `utask_${randomUUID()}`
    persistMessage(run.lastRunId, 'agent_task', { summary: text, from: '用户', to }, 'user', [to], taskId)
    return NextResponse.json({ ok: true, taskId })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'mesh message failed' },
      { status: error instanceof Error && error.message.startsWith('unknown mesh workshop:') ? 404 : 500 },
    )
  }
}
