import { NextRequest, NextResponse } from 'next/server'
import { ensureRunScheduled } from '@/lib/team-run/runtime-manager'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    ensureRunScheduled(id)

    return NextResponse.json({ success: true, runId: id })
  } catch (error) {
    console.error('Start team run error:', error)
    return NextResponse.json(
      { error: 'Failed to start team run' },
      { status: 500 }
    )
  }
}
