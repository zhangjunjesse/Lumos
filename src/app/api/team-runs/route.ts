import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db/connection'
import { TeamRunOrchestrator } from '@/lib/team-run/orchestrator'
import { migrateTeamRunTables } from '@/lib/db/migrations-team-run'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { planId, stages } = body

    if (!planId || !stages || !Array.isArray(stages)) {
      return NextResponse.json(
        { error: 'Missing required fields: planId, stages' },
        { status: 400 }
      )
    }

    const db = getDb()
    migrateTeamRunTables(db)

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const now = Date.now()

    // 创建 run
    db.prepare(`
      INSERT INTO team_runs (id, plan_id, status, created_at)
      VALUES (?, ?, ?, ?)
    `).run(runId, planId, 'pending', now)

    // 创建 stages
    for (const stage of stages) {
      db.prepare(`
        INSERT INTO team_run_stages (id, run_id, name, role_id, task, status, dependencies, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        stage.id || `stage-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        runId,
        stage.name,
        stage.roleId,
        stage.task,
        'pending',
        JSON.stringify(stage.dependencies || []),
        now,
        now
      )
    }

    return NextResponse.json({ runId, status: 'pending' })
  } catch (error) {
    console.error('Create team run error:', error)
    return NextResponse.json(
      { error: 'Failed to create team run' },
      { status: 500 }
    )
  }
}
