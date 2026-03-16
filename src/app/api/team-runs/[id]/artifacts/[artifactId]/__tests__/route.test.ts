import fs from 'fs'
import os from 'os'
import path from 'path'
import { createTeamRunSkeleton, TEAM_PLAN_TASK_KIND } from '@/types'

function buildPlan() {
  return {
    version: 1 as const,
    summary: 'Artifact access test',
    activationReason: 'main_agent_suggested' as const,
    userGoal: 'Read runtime artifacts safely.',
    expectedOutcome: 'Artifacts can be opened and downloaded by run-scoped id.',
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
        responsibility: 'Produce runtime artifacts',
      },
    ],
    tasks: [
      {
        id: 'artifact-stage',
        title: 'Write artifact',
        ownerRoleId: 'worker',
        summary: 'Persist a runtime artifact.',
        dependsOn: [],
        expectedOutput: 'An artifact stored in the runtime tables.',
      },
    ],
  }
}

describe('GET /api/team-runs/[id]/artifacts/[artifactId]', () => {
  let tmpDir = ''

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-run-artifact-route-test-'))
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

  async function createRunWithArtifact() {
    const { createSession, getDb } = require('@/lib/db') as typeof import('@/lib/db')
    const { upsertTeamPlanTask, updateTeamPlanApproval } = require('@/lib/db/tasks') as typeof import('@/lib/db/tasks')
    const { GET } = require('../route') as typeof import('../route')
    const { NextRequest } = require('next/server') as typeof import('next/server')

    const plan = buildPlan()
    const session = createSession('Artifact Route Session')
    const task = upsertTeamPlanTask(session.id, {
      kind: TEAM_PLAN_TASK_KIND,
      plan,
      approvalStatus: 'pending',
      run: createTeamRunSkeleton(plan),
      sourceMessageId: 'msg-artifact-route-001',
      approvedAt: null,
      rejectedAt: null,
      lastActionAt: null,
    })
    const approved = updateTeamPlanApproval(task.id, 'approved')
    const runId = approved?.current_run_id as string
    const db = getDb()
    const stage = db.prepare(`
      SELECT id
      FROM team_run_stages
      WHERE run_id = ?
      ORDER BY created_at ASC
      LIMIT 1
    `).get(runId) as { id: string }

    db.prepare(`
      INSERT INTO team_run_artifacts (id, run_id, stage_id, type, title, source_path, content, content_type, size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'artifact-test-001',
      runId,
      stage.id,
      'metadata',
      'Stage report',
      'report.md',
      Buffer.from('# Report\n\nHello artifact.'),
      'text/markdown',
      Buffer.byteLength('# Report\n\nHello artifact.'),
      Date.now(),
    )

    return { GET, NextRequest, runId }
  }

  test('returns the artifact body with inline headers', async () => {
    const { GET, NextRequest, runId } = await createRunWithArtifact()

    const request = new NextRequest(`http://localhost/api/team-runs/${runId}/artifacts/artifact-test-001`)
    const response = await GET(request, {
      params: Promise.resolve({ id: runId, artifactId: 'artifact-test-001' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/markdown')
    expect(response.headers.get('content-disposition')).toContain('inline;')
    expect(response.headers.get('content-disposition')).toContain('report.md')
    expect(await response.text()).toBe('# Report\n\nHello artifact.')
  })

  test('supports attachment download mode', async () => {
    const { GET, NextRequest, runId } = await createRunWithArtifact()

    const request = new NextRequest(`http://localhost/api/team-runs/${runId}/artifacts/artifact-test-001?download=1`)
    const response = await GET(request, {
      params: Promise.resolve({ id: runId, artifactId: 'artifact-test-001' }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('attachment;')
  })

  test('returns 404 when the artifact is outside the run scope', async () => {
    const { GET, NextRequest, runId } = await createRunWithArtifact()

    const request = new NextRequest('http://localhost/api/team-runs/run-other/artifacts/artifact-test-001')
    const response = await GET(request, {
      params: Promise.resolve({ id: 'run-other', artifactId: 'artifact-test-001' }),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Artifact not found' })
  })
})
