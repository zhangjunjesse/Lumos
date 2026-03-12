import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/connection'
import { TeamRunOrchestrator } from '@/lib/team-run/orchestrator'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const db = getDb()
    const orchestrator = new TeamRunOrchestrator(db)

    await orchestrator.pauseRun(id)

    return NextResponse.json({ success: true, runId: id })
  } catch (error) {
    console.error('Pause team run error:', error)
    return NextResponse.json(
      { error: 'Failed to pause team run' },
      { status: 500 }
    )
  }
}
