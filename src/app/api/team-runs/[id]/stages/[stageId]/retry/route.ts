import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db/connection'
import { getTeamRunDetailProjection } from '@/lib/team-run/projections'
import { TeamRunOrchestrator } from '@/lib/team-run/orchestrator'
import { ensureRunScheduled } from '@/lib/team-run/runtime-manager'
import type { ErrorResponse, TeamRunDetailProjectionResponseV1 } from '@/types'

interface RouteContext {
  params: Promise<{ id: string; stageId: string }>
}

export async function POST(_request: Request, context: RouteContext) {
  const { id, stageId } = await context.params

  try {
    const db = getDb()
    const orchestrator = new TeamRunOrchestrator(db)
    await orchestrator.retryStage(id, stageId)

    ensureRunScheduled(id)
    const team = getTeamRunDetailProjection(id)
    if (!team) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Run not found' },
        { status: 404 },
      )
    }

    return NextResponse.json<TeamRunDetailProjectionResponseV1>({ team })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to retry stage'
    const status = /not found|does not allow retry|Only failed stages|Retry limit reached/i.test(message) ? 400 : 500
    return NextResponse.json<ErrorResponse>(
      { error: message },
      { status },
    )
  }
}
