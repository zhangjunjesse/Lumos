interface TeamRunStage {
  id: string
  runId: string
  name: string
  roleId: string
  task: string
  status: string
  dependencies: string[]
  createdAt: number
  updatedAt: number
}

interface WorkspaceConfig {
  stageWorkDir: string
  sharedReadDir: string
  outputDir: string
}

interface AgentBudget {
  maxRunMinutes: number
  maxTokens: number
}

interface ExecutionContext {
  runId: string
  workspace: WorkspaceConfig
  dependencies: DependencyData[]
  budget: AgentBudget
}

interface DependencyData {
  stageId: string
  output: string
  artifacts?: any[]
}

interface StageResult {
  stageId: string
  status: 'done' | 'failed'
  output: string
  artifacts: string[]
  error?: string
  duration: number
  metrics: ExecutionMetrics
}

interface ExecutionMetrics {
  agentStartTime: number
  agentEndTime: number
  tokensUsed?: number
  apiCalls?: number
}

interface WorkerStatus {
  stageId: string
  state: 'idle' | 'preparing' | 'running' | 'finishing' | 'cancelled'
  progress?: number
}

export class StageWorker {
  private currentStageId: string = ''
  private state: WorkerStatus['state'] = 'idle'

  async execute(stage: TeamRunStage, context: ExecutionContext): Promise<StageResult> {
    this.currentStageId = stage.id
    this.state = 'running'

    const startTime = Date.now()

    try {
      // 模拟执行（实际应调用 Claude SDK）
      const output = `Executed task: ${stage.task}`

      this.state = 'idle'

      return {
        stageId: stage.id,
        status: 'done',
        output,
        artifacts: [],
        duration: Date.now() - startTime,
        metrics: {
          agentStartTime: startTime,
          agentEndTime: Date.now()
        }
      }
    } catch (error) {
      this.state = 'idle'

      return {
        stageId: stage.id,
        status: 'failed',
        output: '',
        artifacts: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
        metrics: {
          agentStartTime: startTime,
          agentEndTime: Date.now()
        }
      }
    }
  }

  async cancel(): Promise<void> {
    this.state = 'cancelled'
  }

  getStatus(): WorkerStatus {
    return {
      stageId: this.currentStageId,
      state: this.state
    }
  }
}
