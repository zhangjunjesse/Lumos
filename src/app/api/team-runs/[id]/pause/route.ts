import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/connection'
import { TeamRunOrchestrator } from '@/lib/team-run/orchestrator'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const db = getDb()
    const orchestrator = new TeamRunOrchestrator(db)

    await orchestrator.pauseRun(params.id)

    return NextResponse.json({ success: true, runId: params.id })
  } catch (error) {
    console.error('Pause team run error:', error)
    return NextResponse.json(
      { error: 'Failed to pause team run' },
      { status: 500 }
    )
  }
}
