import fs from 'fs'
import os from 'os'
import path from 'path'
import { createTeamRunSkeleton, TEAM_PLAN_TASK_KIND } from '@/types'

function buildPlan() {
  return {
    version: 1 as const,
    summary: 'Publish team summary',
    activationReason: 'main_agent_suggested' as const,
    userGoal: 'Ship the team summary flow.',
    expectedOutcome: 'A publishable team summary reaches the main agent chat.',
    roles: [
      {
        id: 'main',
        name: 'Main Agent',
        kind: 'main_agent' as const,
        responsibility: 'User-facing coordination',
      },
      {
        id: 'worker',
        name: 'Worker',
        kind: 'worker' as const,
        responsibility: 'Complete the stage',
      },
    ],
    tasks: [
      {
        id: 'stage-publish',
        title: 'Prepare final summary',
        ownerRoleId: 'worker',
        summary: 'Generate the final team summary.',
        dependsOn: [],
        expectedOutput: 'A final summary ready for publish.',
      },
    ],
  }
}

describe('POST /api/team-runs/[id]/publish-summary', () => {
  let tmpDir = ''

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-publish-summary-test-'))
    delete process.env.LUMOS_DATA_DIR
    process.env.CLAUDE_GUI_DATA_DIR = tmpDir
    fs.writeFileSync(path.join(tmpDir, 'lumos.db'), '')
    jest.resetModules()
  })

  afterEach(() => {
    const { closeDb } = require('@/lib/db') as typeof import('@/lib/db')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
    delete process.env.CLAUDE_GUI_DATA_DIR
    jest.resetModules()
  })

  async function createApprovedRun() {
    const { createSession, getDb, getMessages } = require('@/lib/db') as typeof import('@/lib/db')
    const { upsertTeamPlanTask, updateTeamPlanApproval } = require('@/lib/db/tasks') as typeof import('@/lib/db/tasks')
    const { POST } = require('../route') as typeof import('../route')
    const { NextRequest } = require('next/server') as typeof import('next/server')

    const plan = buildPlan()
    const session = createSession('Publish Summary Session')
    const task = upsertTeamPlanTask(session.id, {
      kind: TEAM_PLAN_TASK_KIND,
      plan,
      approvalStatus: 'pending',
      run: createTeamRunSkeleton(plan),
      sourceMessageId: 'msg-publish-summary-001',
      approvedAt: null,
      rejectedAt: null,
      lastActionAt: null,
    })
    const approved = updateTeamPlanApproval(task.id, 'approved')
    const runId = approved?.current_run_id as string

    getDb().prepare(`
      UPDATE team_runs
      SET status = ?, summary = ?, final_summary = ?
      WHERE id = ?
    `).run(
      'done',
      'Run summary ready to publish.',
      'Final summary ready to publish.',
      runId,
    )

    return {
      POST,
      NextRequest,
      getDb,
      getMessages,
      sessionId: session.id,
      taskId: task.id,
      runId,
    }
  }

  test('publishes the summary, persists published_at, and writes back the task result', async () => {
    const { POST, NextRequest, getDb, getMessages, sessionId, taskId, runId } = await createApprovedRun()

    const request = new NextRequest(`http://localhost/api/team-runs/${runId}/publish-summary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        finalSummary: 'Published final summary.',
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: runId }) })
    const body = await response.json()

    const run = getDb().prepare('SELECT final_summary, published_at FROM team_runs WHERE id = ?').get(runId) as {
      final_summary: string
      published_at: string | null
    }
    const task = getDb().prepare('SELECT final_result_summary FROM tasks WHERE id = ?').get(taskId) as {
      final_result_summary: string
    }
    const events = getDb().prepare(`
      SELECT event_type
      FROM team_run_events
      WHERE run_id = ?
      ORDER BY created_at ASC
    `).all(runId) as Array<{ event_type: string }>
    const messages = getMessages(sessionId).messages

    expect(response.status).toBe(200)
    expect(body.alreadyPublished).toBe(false)
    expect(body.messageId).toBeTruthy()
    expect(run.final_summary).toBe('Published final summary.')
    expect(run.published_at).toBeTruthy()
    expect(task.final_result_summary).toBe('Published final summary.')
    expect(events.map((event) => event.event_type)).toContain('summary.published')
    expect(messages[messages.length - 1]?.content).toBe('Published final summary.')
  })

  test('is idempotent unless force=1 is provided', async () => {
    const { POST, NextRequest, getDb, getMessages, sessionId, runId } = await createApprovedRun()

    const firstRequest = new NextRequest(`http://localhost/api/team-runs/${runId}/publish-summary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        finalSummary: 'Publish once.',
      }),
    })
    const firstResponse = await POST(firstRequest, { params: Promise.resolve({ id: runId }) })
    const firstBody = await firstResponse.json()

    const secondRequest = new NextRequest(`http://localhost/api/team-runs/${runId}/publish-summary`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const secondResponse = await POST(secondRequest, { params: Promise.resolve({ id: runId }) })
    const secondBody = await secondResponse.json()

    expect(firstBody.alreadyPublished).toBe(false)
    expect(secondBody.alreadyPublished).toBe(true)
    expect(getMessages(sessionId).messages.filter((message) => message.role === 'assistant')).toHaveLength(1)

    const forceRequest = new NextRequest(`http://localhost/api/team-runs/${runId}/publish-summary?force=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const forceResponse = await POST(forceRequest, { params: Promise.resolve({ id: runId }) })
    const forceBody = await forceResponse.json()
    const events = getDb().prepare(`
      SELECT event_type
      FROM team_run_events
      WHERE run_id = ? AND event_type = 'summary.published'
      ORDER BY created_at ASC
    `).all(runId) as Array<{ event_type: string }>

    expect(forceResponse.status).toBe(200)
    expect(forceBody.alreadyPublished).toBe(false)
    expect(getMessages(sessionId).messages.filter((message) => message.role === 'assistant')).toHaveLength(2)
    expect(events).toHaveLength(2)
  })
})
