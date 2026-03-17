import * as fs from 'fs'
import * as path from 'path'
import Database from 'better-sqlite3'
import { migrateTeamRunTables } from '../../db/migrations-team-run'
import { TeamRunOrchestrator } from '../orchestrator'
import { StageWorker } from '../stage-worker'

class FakeSuccessWorker extends StageWorker {
  override async execute(stage: Parameters<StageWorker['execute']>[0]): Promise<any> {
    return {
      contractVersion: 'stage-execution-result/v1',
      runId: stage.runId,
      stageId: stage.stageId,
      attempt: stage.attempt,
      outcome: 'done',
      summary: `completed:${stage.stage.title}`,
      artifacts: [],
      memoryAppend: [{ scope: 'agent', content: `done:${stage.stage.title}` }],
      metrics: {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
      },
    }
  }
}

class CapturingWorker extends StageWorker {
  readonly payloads: Array<Parameters<StageWorker['execute']>[0]> = []

  override async execute(stage: Parameters<StageWorker['execute']>[0]): Promise<any> {
    this.payloads.push(stage)
    return {
      contractVersion: 'stage-execution-result/v1',
      runId: stage.runId,
      stageId: stage.stageId,
      attempt: stage.attempt,
      outcome: 'done',
      summary: `completed:${stage.stage.title}`,
      artifacts: [],
      memoryAppend: [{ scope: 'agent', content: `done:${stage.stage.title}` }],
      metrics: {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
      },
    }
  }
}

class FakeFailFirstWorker extends StageWorker {
  override async execute(stage: Parameters<StageWorker['execute']>[0]): Promise<any> {
    if (stage.stageId === 'stage_test_001') {
      return {
        contractVersion: 'stage-execution-result/v1',
        runId: stage.runId,
        stageId: stage.stageId,
        attempt: stage.attempt,
        outcome: 'failed',
        summary: '',
        artifacts: [],
        error: {
          code: 'execution_failed',
          message: 'boom',
          retryable: true,
        },
        metrics: {
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 1,
        },
      }
    }

    return {
      contractVersion: 'stage-execution-result/v1',
      runId: stage.runId,
      stageId: stage.stageId,
      attempt: stage.attempt,
      outcome: 'done',
      summary: `completed:${stage.stage.title}`,
      artifacts: [],
      memoryAppend: [{ scope: 'agent', content: `done:${stage.stage.title}` }],
      metrics: {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
      },
    }
  }
}

class FailureDiagnosticsWorker extends StageWorker {
  override async execute(stage: Parameters<StageWorker['execute']>[0]): Promise<any> {
    return {
      contractVersion: 'stage-execution-result/v1',
      runId: stage.runId,
      stageId: stage.stageId,
      attempt: stage.attempt,
      outcome: 'failed',
      summary: '',
      artifacts: [],
      error: {
        code: 'execution_failed',
        message: 'Task execution failed',
        retryable: true,
      },
      diagnostics: {
        rawMessage: 'Claude SDK did not return structured stage output',
        outputPreview: 'partial output',
        structuredOutputPreview: '{"invalid":true}',
        stderr: 'stderr line',
        roleName: stage.agent.roleName,
        agentType: stage.agent.agentType,
        dependencyCount: stage.dependencies.length,
      },
      metrics: {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
      },
    }
  }
}

class FakeFailOnceWorker extends StageWorker {
  private attempts = new Map<string, number>()

  override async execute(stage: Parameters<StageWorker['execute']>[0]): Promise<any> {
    const count = (this.attempts.get(stage.stageId) || 0) + 1
    this.attempts.set(stage.stageId, count)

    if (stage.stageId === 'stage_test_001' && count === 1) {
      return {
        contractVersion: 'stage-execution-result/v1',
        runId: stage.runId,
        stageId: stage.stageId,
        attempt: stage.attempt,
        outcome: 'failed',
        summary: '',
        artifacts: [],
        error: {
          code: 'execution_failed',
          message: 'boom',
          retryable: true,
        },
        metrics: {
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 1,
        },
      }
    }

    return {
      contractVersion: 'stage-execution-result/v1',
      runId: stage.runId,
      stageId: stage.stageId,
      attempt: stage.attempt,
      outcome: 'done',
      summary: `completed:${stage.stage.title}:attempt-${count}`,
      artifacts: [],
      memoryAppend: [{ scope: 'agent', content: `done:${stage.stage.title}:attempt-${count}` }],
      metrics: {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
      },
    }
  }
}

class DeferredWorker extends StageWorker {
  private startedResolver!: () => void
  private releaseResolver!: (outcome: 'done' | 'failed') => void
  readonly started = new Promise<void>((resolve) => {
    this.startedResolver = resolve
  })
  private readonly released = new Promise<'done' | 'failed'>((resolve) => {
    this.releaseResolver = resolve
  })

  override async execute(stage: Parameters<StageWorker['execute']>[0]): Promise<any> {
    this.startedResolver()
    const outcome = await this.released

    if (outcome === 'failed') {
      return {
        contractVersion: 'stage-execution-result/v1',
        runId: stage.runId,
        stageId: stage.stageId,
        attempt: stage.attempt,
        outcome: 'failed',
        summary: '',
        artifacts: [],
        error: {
          code: 'execution_failed',
          message: 'boom',
          retryable: true,
        },
        metrics: {
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 1,
        },
      }
    }

    return {
      contractVersion: 'stage-execution-result/v1',
      runId: stage.runId,
      stageId: stage.stageId,
      attempt: stage.attempt,
      outcome: 'done',
      summary: `completed:${stage.stage.title}`,
      artifacts: [],
      memoryAppend: [{ scope: 'agent', content: `done:${stage.stage.title}` }],
      metrics: {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
      },
    }
  }

  release(outcome: 'done' | 'failed' = 'done') {
    this.releaseResolver(outcome)
  }
}

class MultiDeferredWorker extends StageWorker {
  readonly startedStageIds: string[] = []
  private resolvers = new Map<string, (outcome: 'done' | 'failed') => void>()
  private waiters: Array<{ count: number; resolve: () => void }> = []

  override async execute(stage: Parameters<StageWorker['execute']>[0]): Promise<any> {
    this.startedStageIds.push(stage.stageId)
    this.notifyWaiters()

    const outcome = await new Promise<'done' | 'failed'>((resolve) => {
      this.resolvers.set(stage.stageId, resolve)
    })

    if (outcome === 'failed') {
      return {
        contractVersion: 'stage-execution-result/v1',
        runId: stage.runId,
        stageId: stage.stageId,
        attempt: stage.attempt,
        outcome: 'failed',
        summary: '',
        artifacts: [],
        error: {
          code: 'execution_failed',
          message: 'boom',
          retryable: true,
        },
        metrics: {
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 1,
        },
      }
    }

    return {
      contractVersion: 'stage-execution-result/v1',
      runId: stage.runId,
      stageId: stage.stageId,
      attempt: stage.attempt,
      outcome: 'done',
      summary: `completed:${stage.stage.title}`,
      artifacts: [],
      memoryAppend: [{ scope: 'agent', content: `done:${stage.stage.title}` }],
      metrics: {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
      },
    }
  }

  waitForStartedCount(count: number): Promise<void> {
    if (this.startedStageIds.length >= count) {
      return Promise.resolve()
    }

    return new Promise((resolve) => {
      this.waiters.push({ count, resolve })
    })
  }

  release(stageId: string, outcome: 'done' | 'failed' = 'done') {
    const resolver = this.resolvers.get(stageId)
    if (!resolver) {
      throw new Error(`No running stage found for ${stageId}`)
    }
    this.resolvers.delete(stageId)
    resolver(outcome)
  }

  private notifyWaiters() {
    this.waiters = this.waiters.filter((waiter) => {
      if (this.startedStageIds.length >= waiter.count) {
        waiter.resolve()
        return false
      }
      return true
    })
  }
}

class ArtifactProducingWorker extends StageWorker {
  readonly payloads: Array<Parameters<StageWorker['execute']>[0]> = []

  override async execute(stage: Parameters<StageWorker['execute']>[0]): Promise<any> {
    this.payloads.push(stage)

    if (stage.stageId === 'stage_test_001') {
      fs.writeFileSync(
        path.join(stage.workspace.artifactOutputDir, 'report.md'),
        '# Stage Report\n\nPrimary deliverable.',
      )
      fs.writeFileSync(
        path.join(stage.workspace.artifactOutputDir, 'debug.log'),
        'debug trace',
      )

      return {
        contractVersion: 'stage-execution-result/v1',
        runId: stage.runId,
        stageId: stage.stageId,
        attempt: stage.attempt,
        outcome: 'done',
        summary: 'completed:Stage 1 with artifacts',
        detailArtifactPath: 'report.md',
        artifacts: [
          {
            kind: 'report',
            title: 'Stage report',
            relativePath: 'report.md',
            contentType: 'text/markdown',
          },
          {
            kind: 'file',
            title: 'debug.log',
            relativePath: 'debug.log',
            contentType: 'text/plain',
          },
        ],
        memoryAppend: [{ scope: 'agent', content: 'done:Stage 1 with artifacts' }],
        metrics: {
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          durationMs: 1,
        },
      }
    }

    return {
      contractVersion: 'stage-execution-result/v1',
      runId: stage.runId,
      stageId: stage.stageId,
      attempt: stage.attempt,
      outcome: 'done',
      summary: `completed:${stage.stage.title}`,
      artifacts: [],
      memoryAppend: [{ scope: 'agent', content: `done:${stage.stage.title}` }],
      metrics: {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 1,
      },
    }
  }
}

async function waitFor(condition: () => boolean, timeoutMs: number = 2000): Promise<void> {
  const startedAt = Date.now()
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function seedRun(db: Database.Database, runId: string) {
  const now = Date.now()
  db.prepare(`
    INSERT INTO team_runs (id, plan_id, task_id, session_id, status, compiled_plan_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    'plan-test-001',
    'task-test-001',
    'session-test-001',
    'ready',
    JSON.stringify({
      contractVersion: 'compiled-run-plan/v1',
      taskId: 'task-test-001',
      sessionId: 'session-test-001',
      runId,
      plannerMode: 'direct_plan_v1',
      workspaceRoot: '/tmp',
      publicTaskContext: {
        userGoal: 'goal',
        summary: 'summary',
        expectedOutcome: 'outcome',
        risks: [],
      },
      roles: [
        {
          roleId: 'role-1',
          externalRoleId: 'worker',
          name: 'Worker',
          roleKind: 'worker',
          responsibility: 'Do the work',
          agentType: 'worker.default',
        },
      ],
      budget: {
        maxParallelWorkers: 2,
        maxRetriesPerTask: 1,
        maxRunMinutes: 10,
      },
      stages: [
        {
          stageId: 'stage_test_001',
          externalTaskId: 'task-1',
          title: 'Stage 1',
          description: 'Do stage 1',
          expectedOutput: 'Output 1',
          ownerRoleId: 'role-1',
          ownerExternalRoleId: 'worker',
          ownerAgentType: 'worker.default',
          dependsOnStageIds: [],
          inputContract: {
            requiredDependencyOutputs: [],
            taskContext: {
              includeUserGoal: true,
              includeExpectedOutcome: true,
              includeRunSummary: true,
            },
          },
          outputContract: {
            primaryFormat: 'markdown',
            mustProduceSummary: true,
            mayProduceArtifacts: true,
            artifactKinds: ['file'],
          },
          acceptanceCriteria: ['done'],
        },
        {
          stageId: 'stage_test_002',
          externalTaskId: 'task-2',
          title: 'Stage 2',
          description: 'Do stage 2',
          expectedOutput: 'Output 2',
          ownerRoleId: 'role-1',
          ownerExternalRoleId: 'worker',
          ownerAgentType: 'worker.default',
          dependsOnStageIds: ['stage_test_001'],
          inputContract: {
            requiredDependencyOutputs: [
              { fromStageId: 'stage_test_001', kind: 'summary', required: true },
            ],
            taskContext: {
              includeUserGoal: true,
              includeExpectedOutcome: true,
              includeRunSummary: true,
            },
          },
          outputContract: {
            primaryFormat: 'markdown',
            mustProduceSummary: true,
            mayProduceArtifacts: true,
            artifactKinds: ['file'],
          },
          acceptanceCriteria: ['done'],
        },
      ],
      stageOrder: ['stage_test_001', 'stage_test_002'],
      createdAt: new Date(now).toISOString(),
    }),
    now,
  )

  db.prepare(`
    INSERT INTO team_run_stages (
      id, run_id, name, role_id, task, plan_task_id, description, owner_agent_type, status, dependencies,
      input_contract_json, output_contract_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'stage_test_001',
    runId,
    'Stage 1',
    'role-1',
    'Do stage 1',
    'task-1',
    'Do stage 1',
    'worker.default',
    'ready',
    '[]',
    '{}',
    '{}',
    now,
    now,
  )

  db.prepare(`
    INSERT INTO team_run_stages (
      id, run_id, name, role_id, task, plan_task_id, description, owner_agent_type, status, dependencies,
      input_contract_json, output_contract_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'stage_test_002',
    runId,
    'Stage 2',
    'role-1',
    'Do stage 2',
    'task-2',
    'Do stage 2',
    'worker.default',
    'pending',
    '["stage_test_001"]',
    '{}',
    '{}',
    now,
    now,
  )
}

function seedParallelRun(db: Database.Database, runId: string) {
  const now = Date.now()
  db.prepare(`
    INSERT INTO team_runs (id, plan_id, task_id, session_id, status, compiled_plan_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    runId,
    'plan-parallel-001',
    'task-test-001',
    'session-test-001',
    'ready',
    JSON.stringify({
      contractVersion: 'compiled-run-plan/v1',
      taskId: 'task-test-001',
      sessionId: 'session-test-001',
      runId,
      plannerMode: 'direct_plan_v1',
      workspaceRoot: '/tmp',
      publicTaskContext: {
        userGoal: 'goal',
        summary: 'summary',
        expectedOutcome: 'outcome',
        risks: [],
      },
      roles: [
        {
          roleId: 'role-1',
          externalRoleId: 'worker',
          name: 'Worker',
          roleKind: 'worker',
          responsibility: 'Do the work',
          agentType: 'worker.default',
          agentDefinitionId: 'agent-def:worker.default',
          systemPrompt: 'You are a worker.',
          allowedTools: ['workspace.read', 'workspace.write'],
          capabilityTags: ['execution'],
          outputSchema: 'stage-execution-result/v1',
          memoryPolicy: 'ephemeral-stage',
          concurrencyLimit: 1,
        },
      ],
      budget: {
        maxParallelWorkers: 2,
        maxRetriesPerTask: 1,
        maxRunMinutes: 10,
      },
      stages: [
        {
          stageId: 'stage_parallel_001',
          externalTaskId: 'task-1',
          title: 'Parallel Stage 1',
          description: 'Do parallel stage 1',
          expectedOutput: 'Output 1',
          ownerRoleId: 'role-1',
          ownerExternalRoleId: 'worker',
          ownerAgentType: 'worker.default',
          ownerAgentDefinitionId: 'agent-def:worker.default',
          dependsOnStageIds: [],
          inputContract: {
            requiredDependencyOutputs: [],
            taskContext: {
              includeUserGoal: true,
              includeExpectedOutcome: true,
              includeRunSummary: true,
            },
          },
          outputContract: {
            primaryFormat: 'markdown',
            mustProduceSummary: true,
            mayProduceArtifacts: true,
            artifactKinds: ['file'],
          },
          acceptanceCriteria: ['done'],
        },
        {
          stageId: 'stage_parallel_002',
          externalTaskId: 'task-2',
          title: 'Parallel Stage 2',
          description: 'Do parallel stage 2',
          expectedOutput: 'Output 2',
          ownerRoleId: 'role-1',
          ownerExternalRoleId: 'worker',
          ownerAgentType: 'worker.default',
          ownerAgentDefinitionId: 'agent-def:worker.default',
          dependsOnStageIds: [],
          inputContract: {
            requiredDependencyOutputs: [],
            taskContext: {
              includeUserGoal: true,
              includeExpectedOutcome: true,
              includeRunSummary: true,
            },
          },
          outputContract: {
            primaryFormat: 'markdown',
            mustProduceSummary: true,
            mayProduceArtifacts: true,
            artifactKinds: ['file'],
          },
          acceptanceCriteria: ['done'],
        },
      ],
      stageOrder: ['stage_parallel_001', 'stage_parallel_002'],
      createdAt: new Date(now).toISOString(),
    }),
    now,
  )

  ;['stage_parallel_001', 'stage_parallel_002'].forEach((stageId, index) => {
    db.prepare(`
      INSERT INTO team_run_stages (
        id, run_id, name, role_id, task, plan_task_id, description, owner_agent_type, agent_definition_id, status,
        dependencies, input_contract_json, output_contract_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stageId,
      runId,
      `Parallel Stage ${index + 1}`,
      'role-1',
      `Do parallel stage ${index + 1}`,
      `task-${index + 1}`,
      `Do parallel stage ${index + 1}`,
      'worker.default',
      'agent-def:worker.default',
      'ready',
      '[]',
      '{}',
      '{}',
      now,
      now,
    )
  })
}

describe('TeamRunOrchestrator', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('journal_mode = WAL')
    migrateTeamRunTables(db)
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        token_usage TEXT
      );
    `)
    db.prepare(`
      INSERT INTO chat_sessions (id, updated_at)
      VALUES (?, datetime('now'))
    `).run('session-test-001')
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        final_result_summary TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    db.prepare(`
      INSERT INTO tasks (id, status, final_result_summary, updated_at)
      VALUES (?, 'pending', '', datetime('now'))
    `).run('task-test-001')
  })

  afterEach(() => {
    db.close()
  })

  test('processRun completes stages and finalizes the run', async () => {
    seedRun(db, 'run-success')
    const orchestrator = new TeamRunOrchestrator(db, undefined, 3, () => new FakeSuccessWorker())

    await orchestrator.processRun('run-success')

    const run = db.prepare('SELECT status, final_summary FROM team_runs WHERE id = ?').get('run-success') as any
    const stages = db.prepare('SELECT id, status, latest_result FROM team_run_stages WHERE run_id = ? ORDER BY id').all('run-success') as any[]

    expect(run.status).toBe('done')
    expect(run.final_summary).toContain('Stage 1')
    expect(stages.map((stage) => stage.status)).toEqual(['done', 'done'])
    expect(stages[0].latest_result).toBe('completed:Stage 1')
  })

  test('processRun fails the run and blocks downstream stages on dependency failure', async () => {
    seedRun(db, 'run-failed')
    const orchestrator = new TeamRunOrchestrator(db, undefined, 3, () => new FakeFailFirstWorker())

    await orchestrator.processRun('run-failed')

    const run = db.prepare('SELECT status FROM team_runs WHERE id = ?').get('run-failed') as any
    const stages = db.prepare('SELECT id, status, error FROM team_run_stages WHERE run_id = ? ORDER BY id').all('run-failed') as any[]
    const task = db.prepare('SELECT status FROM tasks WHERE id = ?').get('task-test-001') as any

    expect(run.status).toBe('failed')
    expect(stages[0].status).toBe('failed')
    expect(stages[1].status).toBe('blocked')
    expect(stages[1].error).toContain('Blocked by failed dependency')
    expect(task.status).toBe('failed')
  })

  test('processRun persists failure diagnostics artifacts for failed stages', async () => {
    seedRun(db, 'run-failure-diagnostics')
    const orchestrator = new TeamRunOrchestrator(db, undefined, 3, () => new FailureDiagnosticsWorker())

    await orchestrator.processRun('run-failure-diagnostics')

    const attempt = db.prepare(`
      SELECT status, error_message, result_artifact_id
      FROM team_run_stage_attempts
      WHERE run_id = ? AND stage_id = ? AND attempt_no = 1
    `).get('run-failure-diagnostics', 'stage_test_001') as {
      status: string
      error_message: string | null
      result_artifact_id: string | null
    }
    const artifact = db.prepare(`
      SELECT id, type, title, source_path, content_type, content
      FROM team_run_artifacts
      WHERE run_id = ? AND stage_id = ? AND title = ?
    `).get('run-failure-diagnostics', 'stage_test_001', 'Failure diagnostics') as {
      id: string
      type: string
      title: string
      source_path: string
      content_type: string
      content: string
    }
    const payload = JSON.parse(artifact.content) as {
      diagnostics?: {
        rawMessage?: string
        outputPreview?: string
      }
    }
    const event = db.prepare(`
      SELECT payload_json
      FROM team_run_events
      WHERE run_id = ? AND stage_id = ? AND event_type = ?
      ORDER BY created_at ASC
      LIMIT 1
    `).get('run-failure-diagnostics', 'stage_test_001', 'stage.failed') as { payload_json: string }

    expect(attempt.status).toBe('failed')
    expect(attempt.error_message).toContain('Claude SDK did not return structured stage output')
    expect(attempt.error_message).toContain('output_preview:\npartial output')
    expect(attempt.result_artifact_id).toBe(artifact.id)
    expect(artifact).toMatchObject({
      type: 'log',
      title: 'Failure diagnostics',
      source_path: 'failure-diagnostics.json',
      content_type: 'application/json',
    })
    expect(payload.diagnostics).toMatchObject({
      rawMessage: 'Claude SDK did not return structured stage output',
      outputPreview: 'partial output',
    })
    expect(JSON.parse(event.payload_json)).toMatchObject({
      diagnosticsArtifactId: artifact.id,
    })
  })

  test('processRun creates attempts, agent instances, and memory spaces for stage execution', async () => {
    seedRun(db, 'run-runtime-records')
    const orchestrator = new TeamRunOrchestrator(db, undefined, 3, () => new FakeSuccessWorker())

    await orchestrator.processRun('run-runtime-records')

    const attempts = db.prepare(`
      SELECT stage_id, attempt_no, status, agent_instance_id
      FROM team_run_stage_attempts
      WHERE run_id = ?
      ORDER BY stage_id, attempt_no
    `).all('run-runtime-records') as Array<{ stage_id: string; attempt_no: number; status: string; agent_instance_id: string | null }>
    const agentInstances = db.prepare(`
      SELECT stage_id, status, memory_space_id
      FROM team_run_agent_instances
      WHERE run_id = ?
      ORDER BY stage_id
    `).all('run-runtime-records') as Array<{ stage_id: string; status: string; memory_space_id: string | null }>
    const memories = db.prepare(`
      SELECT owner_type, owner_id, content
      FROM team_run_memories
      WHERE run_id = ?
      ORDER BY owner_type, owner_id
    `).all('run-runtime-records') as Array<{ owner_type: string; owner_id: string; content: string }>

    expect(attempts).toHaveLength(2)
    expect(attempts.map((attempt) => [attempt.stage_id, attempt.attempt_no, attempt.status])).toEqual([
      ['stage_test_001', 1, 'done'],
      ['stage_test_002', 1, 'done'],
    ])
    expect(attempts.every((attempt) => Boolean(attempt.agent_instance_id))).toBe(true)

    expect(agentInstances).toHaveLength(2)
    expect(agentInstances.every((instance) => instance.status === 'completed')).toBe(true)
    expect(agentInstances.every((instance) => Boolean(instance.memory_space_id))).toBe(true)

    expect(memories.filter((memory) => memory.owner_type === 'task')).toHaveLength(1)
    expect(memories.filter((memory) => memory.owner_type === 'planner')).toHaveLength(1)
    expect(memories.filter((memory) => memory.owner_type === 'agent_instance')).toHaveLength(2)
    expect(memories.some((memory) => memory.content.includes('Stage Stage 1 attempt 1 [done]'))).toBe(true)
  })

  test('processRun persists stage artifacts and exposes artifact refs to downstream stages', async () => {
    seedRun(db, 'run-artifacts')
    const worker = new ArtifactProducingWorker()
    const orchestrator = new TeamRunOrchestrator(db, undefined, 3, () => worker)

    await orchestrator.processRun('run-artifacts')

    const artifacts = db.prepare(`
      SELECT id, type, title, source_path, content_type, size
      FROM team_run_artifacts
      WHERE run_id = ? AND stage_id = ?
      ORDER BY source_path ASC, id ASC
    `).all('run-artifacts', 'stage_test_001') as Array<{
      id: string
      type: string
      title: string
      source_path: string | null
      content_type: string
      size: number
    }>
    const stage = db.prepare(`
      SELECT latest_result, latest_result_ref
      FROM team_run_stages
      WHERE id = ?
    `).get('stage_test_001') as { latest_result: string | null; latest_result_ref: string | null }
    const attempt = db.prepare(`
      SELECT status, result_summary, result_artifact_id
      FROM team_run_stage_attempts
      WHERE run_id = ? AND stage_id = ? AND attempt_no = 1
    `).get('run-artifacts', 'stage_test_001') as {
      status: string
      result_summary: string
      result_artifact_id: string | null
    }
    const stageTwoPayload = worker.payloads.find((payload) => payload.stageId === 'stage_test_002')
    const debugArtifact = artifacts.find((artifact) => artifact.source_path === 'debug.log')
    const reportArtifact = artifacts.find((artifact) => artifact.source_path === 'report.md')

    expect(artifacts).toHaveLength(2)
    expect(debugArtifact).toMatchObject({
      type: 'file',
      title: 'debug.log',
      source_path: 'debug.log',
      content_type: 'text/plain',
    })
    expect(reportArtifact).toMatchObject({
      type: 'metadata',
      title: 'Stage report',
      source_path: 'report.md',
      content_type: 'text/markdown',
    })
    expect(reportArtifact?.size).toBeGreaterThan(0)

    expect(stage.latest_result).toBe('completed:Stage 1 with artifacts')
    expect(stage.latest_result_ref).toBe(reportArtifact?.id || null)

    expect(attempt).toEqual({
      status: 'done',
      result_summary: 'completed:Stage 1 with artifacts',
      result_artifact_id: reportArtifact?.id || null,
    })

    expect(stageTwoPayload?.dependencies).toHaveLength(1)
    expect(stageTwoPayload?.dependencies[0].summary).toBe('completed:Stage 1 with artifacts')
    expect(stageTwoPayload?.dependencies[0].artifactRefs).toHaveLength(2)
    expect(stageTwoPayload?.dependencies[0].artifactRefs).toEqual(
      expect.arrayContaining([reportArtifact!.id, debugArtifact!.id]),
    )
  })

  test('processRun passes compiled agent definitions to stage workers when available', async () => {
    seedRun(db, 'run-agent-definition')

    const compiledPlan = JSON.parse(
      (db.prepare('SELECT compiled_plan_json FROM team_runs WHERE id = ?').get('run-agent-definition') as any).compiled_plan_json,
    )
    compiledPlan.roles[0] = {
      ...compiledPlan.roles[0],
      agentType: 'preset.worker-template',
      agentDefinitionId: 'agent-def:preset-worker-template',
      systemPrompt: 'Preset worker system prompt.',
      allowedTools: ['workspace.read', 'workspace.write'],
      capabilityTags: ['execution', 'preset'],
      outputSchema: 'stage-execution-result/v1',
      memoryPolicy: 'sticky-run',
      concurrencyLimit: 2,
      presetId: 'preset-worker-template',
    }
    compiledPlan.stages = compiledPlan.stages.map((stage: any) => ({
      ...stage,
      ownerAgentType: 'preset.worker-template',
      ownerAgentDefinitionId: 'agent-def:preset-worker-template',
    }))

    db.prepare(`
      UPDATE team_runs
      SET compiled_plan_json = ?
      WHERE id = ?
    `).run(JSON.stringify(compiledPlan), 'run-agent-definition')
    db.prepare(`
      UPDATE team_run_stages
      SET agent_definition_id = ?, owner_agent_type = ?
      WHERE run_id = ?
    `).run('agent-def:preset-worker-template', 'preset.worker-template', 'run-agent-definition')

    const worker = new CapturingWorker()
    const orchestrator = new TeamRunOrchestrator(db, undefined, 3, () => worker)

    await orchestrator.processRun('run-agent-definition')

    expect(worker.payloads).toHaveLength(2)
    expect(worker.payloads[0].agent).toMatchObject({
      agentDefinitionId: 'agent-def:preset-worker-template',
      agentType: 'preset.worker-template',
      roleName: 'Worker',
      systemPrompt: 'Preset worker system prompt.',
      allowedTools: ['workspace.read', 'workspace.write'],
      capabilityTags: ['execution', 'preset'],
      memoryPolicy: 'sticky-run',
      outputSchema: 'stage-execution-result/v1',
      concurrencyLimit: 2,
      presetId: 'preset-worker-template',
    })
  })

  test('processRun enforces per-agent concurrency limits from compiled definitions', async () => {
    seedParallelRun(db, 'run-agent-concurrency')
    const worker = new MultiDeferredWorker()
    const orchestrator = new TeamRunOrchestrator(db, undefined, 3, () => worker)
    const processing = orchestrator.processRun('run-agent-concurrency')

    await worker.waitForStartedCount(1)

    expect(worker.startedStageIds).toEqual(['stage_parallel_001'])
    expect(
      db.prepare(`
        SELECT id
        FROM team_run_stages
        WHERE run_id = ? AND status = 'running'
        ORDER BY id
      `).all('run-agent-concurrency') as Array<{ id: string }>,
    ).toEqual([{ id: 'stage_parallel_001' }])

    worker.release('stage_parallel_001')
    await worker.waitForStartedCount(2)

    expect(worker.startedStageIds).toEqual(['stage_parallel_001', 'stage_parallel_002'])

    worker.release('stage_parallel_002')
    await processing

    const run = db.prepare('SELECT status FROM team_runs WHERE id = ?').get('run-agent-concurrency') as any
    const stages = db.prepare(`
      SELECT id, status
      FROM team_run_stages
      WHERE run_id = ?
      ORDER BY id
    `).all('run-agent-concurrency') as Array<{ id: string; status: string }>

    expect(run.status).toBe('done')
    expect(stages).toEqual([
      { id: 'stage_parallel_001', status: 'done' },
      { id: 'stage_parallel_002', status: 'done' },
    ])
  })

  test('pauseRun immediately pauses an idle run', async () => {
    seedRun(db, 'run-pause-idle')
    const orchestrator = new TeamRunOrchestrator(db, undefined, 3, () => new FakeSuccessWorker())

    await orchestrator.pauseRun('run-pause-idle')

    const run = db.prepare('SELECT status, pause_requested_at FROM team_runs WHERE id = ?').get('run-pause-idle') as any
    const events = db.prepare('SELECT event_type FROM team_run_events WHERE run_id = ? ORDER BY created_at ASC').all('run-pause-idle') as Array<{ event_type: string }>

    expect(run.status).toBe('paused')
    expect(run.pause_requested_at).toBeTruthy()
    expect(events.map((event) => event.event_type)).toEqual(['run.pause_requested', 'run.paused'])
  })

  test('pauseRun drains the in-flight stage before entering paused', async () => {
    seedRun(db, 'run-pause-drain')
    const worker = new DeferredWorker()
    const orchestrator = new TeamRunOrchestrator(db, undefined, 3, () => worker)
    const processing = orchestrator.processRun('run-pause-drain')

    await worker.started
    await waitFor(() => {
      const run = db.prepare('SELECT status FROM team_runs WHERE id = ?').get('run-pause-drain') as any
      const stage = db.prepare('SELECT status FROM team_run_stages WHERE id = ?').get('stage_test_001') as any
      return run?.status === 'running' && stage?.status === 'running'
    })

    await orchestrator.pauseRun('run-pause-drain')

    const requestedRun = db.prepare('SELECT status, pause_requested_at FROM team_runs WHERE id = ?').get('run-pause-drain') as any
    expect(requestedRun.status).toBe('running')
    expect(requestedRun.pause_requested_at).toBeTruthy()

    worker.release('done')
    await processing

    const run = db.prepare('SELECT status FROM team_runs WHERE id = ?').get('run-pause-drain') as any
    const stages = db.prepare('SELECT id, status FROM team_run_stages WHERE run_id = ? ORDER BY id').all('run-pause-drain') as any[]

    expect(run.status).toBe('paused')
    expect(stages.map((stage) => stage.status)).toEqual(['done', 'ready'])
  })

  test('cancelRun drains the current stage and finalizes the run as cancelled', async () => {
    seedRun(db, 'run-cancel-drain')
    const worker = new DeferredWorker()
    const orchestrator = new TeamRunOrchestrator(db, undefined, 3, () => worker)
    const processing = orchestrator.processRun('run-cancel-drain')

    await worker.started
    await waitFor(() => {
      const stage = db.prepare('SELECT status FROM team_run_stages WHERE id = ?').get('stage_test_001') as any
      return stage?.status === 'running'
    })

    await orchestrator.cancelRun('run-cancel-drain')

    const cancellingRun = db.prepare('SELECT status, cancel_requested_at FROM team_runs WHERE id = ?').get('run-cancel-drain') as any
    expect(cancellingRun.status).toBe('cancelling')
    expect(cancellingRun.cancel_requested_at).toBeTruthy()

    worker.release('done')
    await processing

    const run = db.prepare('SELECT status FROM team_runs WHERE id = ?').get('run-cancel-drain') as any
    const stages = db.prepare('SELECT id, status, latest_result FROM team_run_stages WHERE run_id = ? ORDER BY id').all('run-cancel-drain') as any[]
    const events = db.prepare('SELECT event_type FROM team_run_events WHERE run_id = ? ORDER BY created_at ASC').all('run-cancel-drain') as Array<{ event_type: string }>

    expect(run.status).toBe('cancelled')
    expect(stages.map((stage) => stage.status)).toEqual(['cancelled', 'cancelled'])
    expect(stages[0].latest_result).toBe('completed:Stage 1')
    expect(events.map((event) => event.event_type)).toContain('run.cancel_requested')
    expect(events.map((event) => event.event_type)).toContain('run.cancelled')
  })

  test('resumeRun clears pause request and increments runtime resume count', async () => {
    seedRun(db, 'run-resume')
    db.prepare(`
      UPDATE team_runs
      SET status = ?, pause_requested_at = ?, compiled_plan_json = ?
      WHERE id = ?
    `).run(
      'paused',
      Date.now(),
      JSON.stringify({
        ...JSON.parse((db.prepare('SELECT compiled_plan_json FROM team_runs WHERE id = ?').get('run-resume') as any).compiled_plan_json),
        runtimeMeta: {
          version: 1,
          resumeCount: 0,
        },
      }),
      'run-resume',
    )

    const orchestrator = new TeamRunOrchestrator(db, undefined, 3, () => new FakeSuccessWorker())
    await orchestrator.resumeRun('run-resume')

    const run = db.prepare('SELECT status, pause_requested_at, compiled_plan_json FROM team_runs WHERE id = ?').get('run-resume') as any
    const compiledPlan = JSON.parse(run.compiled_plan_json)

    expect(run.status).toBe('running')
    expect(run.pause_requested_at).toBeNull()
    expect(compiledPlan.runtimeMeta.resumeCount).toBe(1)
  })

  test('processRun generates the final summary and emits summary.generated', async () => {
    seedRun(db, 'run-summary')
    const orchestrator = new TeamRunOrchestrator(db, undefined, 3, () => new FakeSuccessWorker())

    await orchestrator.processRun('run-summary')

    const run = db.prepare('SELECT status, final_summary FROM team_runs WHERE id = ?').get('run-summary') as any
    const task = db.prepare('SELECT status, final_result_summary FROM tasks WHERE id = ?').get('task-test-001') as any
    const events = db.prepare('SELECT event_type FROM team_run_events WHERE run_id = ? ORDER BY created_at ASC').all('run-summary') as Array<{ event_type: string }>
    const artifact = db.prepare(`
      SELECT source_path, content_type
      FROM team_run_artifacts
      WHERE run_id = ? AND source_path = 'final-summary.md'
      LIMIT 1
    `).get('run-summary') as { source_path: string; content_type: string } | undefined

    expect(run.status).toBe('done')
    expect(run.final_summary).toContain('# Final Summary')
    expect(run.final_summary).toContain('## Key Outputs')
    expect(run.final_summary).toContain('## Stage 1')
    expect(task.status).toBe('completed')
    expect(task.final_result_summary).toBe(run.final_summary)
    expect(artifact).toEqual({
      source_path: 'final-summary.md',
      content_type: 'text/markdown',
    })
    expect(events.map((event) => event.event_type)).toContain('summary.generated')
  })

  test('processRun publishes progress milestones and final summary back to chat messages', async () => {
    seedRun(db, 'run-chat-sync')
    const orchestrator = new TeamRunOrchestrator(db, undefined, 3, () => new FakeSuccessWorker())

    await orchestrator.processRun('run-chat-sync')

    const messages = db.prepare(`
      SELECT role, content
      FROM messages
      WHERE session_id = ?
      ORDER BY rowid ASC
    `).all('session-test-001') as Array<{ role: string; content: string }>
    const run = db.prepare(`
      SELECT published_at, final_summary
      FROM team_runs
      WHERE id = ?
    `).get('run-chat-sync') as { published_at: string | null; final_summary: string }
    const summaryArtifact = db.prepare(`
      SELECT id
      FROM team_run_artifacts
      WHERE run_id = ? AND source_path = 'final-summary.md'
      LIMIT 1
    `).get('run-chat-sync') as { id: string } | undefined

    expect(messages.map((message) => message.role)).toEqual([
      'assistant',
      'assistant',
      'assistant',
      'assistant',
      'assistant',
      'assistant',
    ])
    expect(messages[0].content).toContain('团队运行已开始')
    expect(messages[1].content).toContain('开始处理《Stage 1》')
    expect(messages[2].content).toContain('已完成《Stage 1》')
    expect(messages[3].content).toContain('开始处理《Stage 2》')
    expect(messages[4].content).toContain('已完成《Stage 2》')
    expect(messages[5].content).toContain('# Final Summary')
    expect(summaryArtifact).toBeTruthy()
    expect(messages[5].content).toContain(`/api/team-runs/run-chat-sync/artifacts/${summaryArtifact?.id}`)
    expect(run.published_at).toBeTruthy()
    expect(messages[5].content).toContain(run.final_summary)
  })

  test('retryStage creates a new attempt and allows blocked downstream stages to resume after success', async () => {
    seedRun(db, 'run-retry')
    const worker = new FakeFailOnceWorker()
    const orchestrator = new TeamRunOrchestrator(db, undefined, 3, () => worker)

    await orchestrator.processRun('run-retry')

    let run = db.prepare('SELECT status FROM team_runs WHERE id = ?').get('run-retry') as any
    let stages = db.prepare(`
      SELECT id, status, retry_count
      FROM team_run_stages
      WHERE run_id = ?
      ORDER BY id
    `).all('run-retry') as any[]
    expect(run.status).toBe('failed')
    expect(stages.map((stage) => stage.status)).toEqual(['failed', 'blocked'])

    await orchestrator.retryStage('run-retry', 'stage_test_001')

    run = db.prepare('SELECT status, error, completed_at FROM team_runs WHERE id = ?').get('run-retry') as any
    stages = db.prepare(`
      SELECT id, status, retry_count, last_attempt_id
      FROM team_run_stages
      WHERE run_id = ?
      ORDER BY id
    `).all('run-retry') as any[]
    const retryAttempts = db.prepare(`
      SELECT stage_id, attempt_no, status
      FROM team_run_stage_attempts
      WHERE run_id = ?
      ORDER BY stage_id, attempt_no
    `).all('run-retry') as any[]
    const events = db.prepare(`
      SELECT event_type
      FROM team_run_events
      WHERE run_id = ?
      ORDER BY created_at ASC
    `).all('run-retry') as Array<{ event_type: string }>

    expect(run.status).toBe('running')
    expect(run.error).toBeNull()
    expect(run.completed_at).toBeNull()
    expect(stages[0].status).toBe('ready')
    expect(stages[0].retry_count).toBe(1)
    expect(stages[0].last_attempt_id).toBeTruthy()
    expect(retryAttempts.map((attempt) => [attempt.stage_id, attempt.attempt_no, attempt.status])).toEqual([
      ['stage_test_001', 1, 'failed'],
      ['stage_test_001', 2, 'created'],
    ])
    expect(events.map((event) => event.event_type)).toContain('stage.retry_requested')

    await orchestrator.processRun('run-retry')

    run = db.prepare('SELECT status, final_summary FROM team_runs WHERE id = ?').get('run-retry') as any
    stages = db.prepare(`
      SELECT id, status, latest_result
      FROM team_run_stages
      WHERE run_id = ?
      ORDER BY id
    `).all('run-retry') as any[]
    const finalAttempts = db.prepare(`
      SELECT stage_id, attempt_no, status
      FROM team_run_stage_attempts
      WHERE run_id = ?
      ORDER BY stage_id, attempt_no
    `).all('run-retry') as any[]

    expect(run.status).toBe('done')
    expect(run.final_summary).toContain('Stage 2')
    expect(stages.map((stage) => stage.status)).toEqual(['done', 'done'])
    expect(stages[0].latest_result).toContain('attempt-2')
    expect(finalAttempts.map((attempt) => [attempt.stage_id, attempt.attempt_no, attempt.status])).toEqual([
      ['stage_test_001', 1, 'failed'],
      ['stage_test_001', 2, 'done'],
      ['stage_test_002', 1, 'done'],
    ])
  })
})
