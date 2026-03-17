import { NextRequest, NextResponse } from 'next/server'
import { addMessage, getDb } from '@/lib/db'
import { getTeamRunDetailProjection } from '@/lib/team-run/projections'
import type { ErrorResponse, TeamRunDetailProjectionResponseV1 } from '@/types'

interface PublishSummaryRequest {
  summary?: string
  finalSummary?: string
  force?: boolean
}

interface RunRow {
  id: string
  task_id: string | null
  session_id: string | null
  summary: string
  final_summary: string
  published_at: string | null
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({})) as PublishSummaryRequest
    const db = getDb()
    const run = db.prepare(`
      SELECT id, task_id, session_id, summary, final_summary, published_at
      FROM team_runs
      WHERE id = ?
    `).get(id) as RunRow | undefined

    if (!run) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Run not found' },
        { status: 404 },
      )
    }

    if (!run.session_id) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Run has no session bound for summary publish' },
        { status: 400 },
      )
    }

    const nextSummary = typeof body.summary === 'string' ? body.summary.trim() : run.summary.trim()
    const requestedFinalSummary = typeof body.finalSummary === 'string' ? body.finalSummary.trim() : run.final_summary.trim()
    const effectiveFinalSummary = requestedFinalSummary || nextSummary
    if (!effectiveFinalSummary) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Final summary is empty' },
        { status: 400 },
      )
    }

    if (nextSummary !== run.summary || effectiveFinalSummary !== run.final_summary) {
      db.prepare(`
        UPDATE team_runs
        SET summary = ?, final_summary = ?, projection_version = projection_version + 1
        WHERE id = ?
      `).run(nextSummary, effectiveFinalSummary, id)

      if (run.task_id) {
        db.prepare(`
          UPDATE tasks
          SET final_result_summary = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(effectiveFinalSummary, run.task_id)
      }
    }

    const force = body.force === true || request.nextUrl.searchParams.get('force') === '1'
    if (run.published_at && !force) {
      const team = getTeamRunDetailProjection(id)
      if (!team) {
        return NextResponse.json<ErrorResponse>(
          { error: 'Run not found' },
          { status: 404 },
        )
      }

      return NextResponse.json<TeamRunDetailProjectionResponseV1 & { alreadyPublished: boolean }>({
        team,
        alreadyPublished: true,
      })
    }

    const message = addMessage(run.session_id, 'assistant', effectiveFinalSummary)
    const publishedAt = new Date().toISOString()

    db.prepare(`
      UPDATE team_runs
      SET published_at = ?, projection_version = projection_version + 1
      WHERE id = ?
    `).run(publishedAt, id)

    db.prepare(`
      INSERT INTO team_run_events (id, run_id, stage_id, event_type, payload_json, created_at)
      VALUES (lower(hex(randomblob(16))), ?, NULL, ?, ?, ?)
    `).run(
      id,
      'summary.published',
      JSON.stringify({ messageId: message.id, publishedAt }),
      Date.now(),
    )

    const team = getTeamRunDetailProjection(id)
    if (!team) {
      return NextResponse.json<ErrorResponse>(
        { error: 'Run not found' },
        { status: 404 },
      )
    }

    return NextResponse.json<TeamRunDetailProjectionResponseV1 & { alreadyPublished: boolean; messageId: string }>({
      team,
      alreadyPublished: false,
      messageId: message.id,
    })
  } catch (error) {
    console.error('Publish team summary error:', error)
    return NextResponse.json(
      { error: 'Failed to publish team summary' },
      { status: 500 },
    )
  }
}
