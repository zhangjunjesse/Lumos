import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/connection'
import { TeamRunOrchestrator } from '@/lib/team-run/orchestrator'
import { getTeamRunDetailProjection } from '@/lib/team-run/projections'
import type { ErrorResponse, TeamRunDetailProjectionResponseV1 } from '@/types'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const db = getDb()
    const orchestrator = new TeamRunOrchestrator(db)

    await orchestrator.cancelRun(id)

    const team = getTeamRunDetailProjection(id)
    if (!team) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Run not found' },
        { status: 404 },
      )
    }

    return NextResponse.json<TeamRunDetailProjectionResponseV1>({ team })
  } catch (error) {
    console.error('Cancel team run error:', error)
    return NextResponse.json(
      { error: 'Failed to cancel team run' },
      { status: 500 }
    )
  }
}
