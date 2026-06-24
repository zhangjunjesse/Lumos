import { NextRequest, NextResponse } from 'next/server'
import { runTeamAssistant, applyTeamActions } from '@/lib/mesh/mesh-team-assistant'
import { DEFAULT_WORKSHOP_ID } from '@/lib/mesh/mesh-constants'
import { ensureWorkshopExists } from '@/lib/mesh/mesh-workshop-store'

/** 团队管家：自然语言管理成员。POST { message, accountId? } -> { reply, applied[], pendingDeletes[] }。 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { message?: unknown; accountId?: unknown }
    if (typeof body.message !== 'string' || !body.message.trim()) {
      return NextResponse.json({ error: 'message required' }, { status: 400 })
    }
    const workshopId = typeof body.accountId === 'string' ? body.accountId : DEFAULT_WORKSHOP_ID
    ensureWorkshopExists(workshopId)
    const { reply, actions } = await runTeamAssistant(body.message, { workshopId })
    const { applied, pendingDeletes } = applyTeamActions(actions, workshopId)
    return NextResponse.json({ reply, applied, pendingDeletes })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: 500 })
  }
}
