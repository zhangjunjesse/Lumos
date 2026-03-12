import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/connection'
import { TeamRunOrchestrator } from '@/lib/team-run/orchestrator'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const db = getDb()
    const orchestrator = new TeamRunOrchestrator(db)

    const status = await orchestrator.getStatus(params.id)

    return NextResponse.json(status)
  } catch (error) {
    console.error('Get team run status error:', error)
    return NextResponse.json(
      { error: 'Failed to get team run status' },
      { status: 500 }
    )
  }
}
