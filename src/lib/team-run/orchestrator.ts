import Database from 'better-sqlite3'
import { StateManager } from './state-manager'
import { DependencyResolver } from './dependency-resolver'
import { StageWorker } from './stage-worker'

type RunStatus = 'pending' | 'ready' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'
type StageStatusType = 'pending' | 'ready' | 'running' | 'waiting' | 'blocked' | 'done' | 'failed' | 'cancelled'

interface TeamRunStatus {
  runId: string
  planId: string
  status: RunStatus
  progress: RunProgress
  stages: StageStatus[]
  startedAt?: number
  completedAt?: number
  error?: string
}

interface RunProgress {
  total: number
  completed: number
  failed: number
  running: number
  blocked: number
}

interface StageStatus {
  id: string
  roleId: string
  task: string
  status: StageStatusType
  dependsOn: string[]
  output?: string
  error?: string
  retryCount: number
  startedAt?: number
  completedAt?: number
  duration?: number
}

export class TeamRunOrchestrator {
  private stateManager: StateManager
  private resolver: DependencyResolver
  private workers: Map<string, StageWorker> = new Map()

  constructor(private db: Database.Database) {
    this.stateManager = new StateManager(db)
    this.resolver = new DependencyResolver()
  }

  async startRun(runId: string): Promise<void> {
    await this.stateManager.updateRunStatus(runId, 'running')

    // 启动后台执行
    this.executeRun(runId).catch(err => {
      console.error('Run execution failed:', err)
    })
  }

  private async executeRun(runId: string): Promise<void> {
    const stages = this.db.prepare('SELECT * FROM team_run_stages WHERE run_id = ?').all(runId) as any[]

    const parsedStages = stages.map(s => ({
      ...s,
      dependencies: JSON.parse(s.dependencies)
    }))

    const batches = this.resolver.buildBatches(parsedStages)
    const completed = new Set<string>()

    for (const batch of batches) {
      await Promise.all(
        batch.stageIds.map(async stageId => {
          const stage = parsedStages.find(s => s.id === stageId)!
          const worker = new StageWorker()

          await this.stateManager.updateStageStatus(stageId, 'running')

          const result = await worker.execute(stage, {
            runId,
            workspace: {
              stageWorkDir: `/tmp/${runId}/${stageId}`,
              sharedReadDir: `/tmp/${runId}/shared`,
              outputDir: `/tmp/${runId}/${stageId}/output`
            },
            dependencies: [],
            budget: { maxRunMinutes: 10, maxTokens: 100000 }
          })

          if (result.status === 'done') {
            await this.stateManager.updateStageStatus(stageId, 'done')
            await this.stateManager.updateStageResult(stageId, result.output)
            completed.add(stageId)
          } else {
            await this.stateManager.updateStageStatus(stageId, 'failed')
            await this.stateManager.updateStageError(stageId, result.error || 'Unknown error')
          }
        })
      )
    }

    await this.stateManager.updateRunStatus(runId, 'done')
  }

  async getStatus(runId: string): Promise<TeamRunStatus> {
    const run = this.db.prepare('SELECT * FROM team_runs WHERE id = ?').get(runId) as any
    const stages = this.db.prepare('SELECT * FROM team_run_stages WHERE run_id = ?').all(runId) as any[]

    const stageStatuses: StageStatus[] = stages.map(s => ({
      id: s.id,
      roleId: s.role_id,
      task: s.task,
      status: s.status,
      dependsOn: JSON.parse(s.dependencies),
      output: s.latest_result,
      error: s.error,
      retryCount: s.retry_count,
      startedAt: s.started_at,
      completedAt: s.completed_at
    }))

    const progress: RunProgress = {
      total: stages.length,
      completed: stages.filter(s => s.status === 'done').length,
      failed: stages.filter(s => s.status === 'failed').length,
      running: stages.filter(s => s.status === 'running').length,
      blocked: stages.filter(s => s.status === 'blocked').length
    }

    return {
      runId: run.id,
      planId: run.plan_id,
      status: run.status,
      progress,
      stages: stageStatuses,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      error: run.error
    }
  }

  async pauseRun(runId: string): Promise<void> {
    await this.stateManager.updateRunStatus(runId, 'paused')
  }

  async cancelRun(runId: string): Promise<void> {
    await this.stateManager.updateRunStatus(runId, 'cancelled')
  }
}
