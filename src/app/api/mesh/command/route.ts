import { NextRequest, NextResponse } from 'next/server'
import { runLeader, applyCommands } from '@/lib/mesh/mesh-leader'
import { DEFAULT_WORKSHOP_ID } from '@/lib/mesh/mesh-constants'

/**
 * 用自然语言给某工作室团队下指令。POST { message, accountId?, sessionId? } -> { reply, applied[], config }
 * Leader(LLM) 拆命令 → Control Plane(确定性) 应用到团队配置 + 审计。够不到下单/券商写。
 * 业务在 lib/mesh，本 route 只做参数解析与响应。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>)
    const message = typeof body.message === 'string' ? body.message : ''
    if (!message.trim()) {
      return NextResponse.json({ error: 'message required' }, { status: 400 })
    }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
    const workshopId = typeof body.accountId === 'string' ? body.accountId : DEFAULT_WORKSHOP_ID
    const { reply, commands } = await runLeader(message, { sessionId, workshopId })
    const { applied, config } = applyCommands(message, commands, workshopId)
    return NextResponse.json({ reply, applied, config })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'mesh command failed' },
      { status: 500 },
    )
  }
}
