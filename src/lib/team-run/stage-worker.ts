import { FileAccessGuard } from './security/file-access-guard'
import { CommandGuard } from './security/command-guard'
import { ErrorSanitizer } from './security/error-sanitizer'

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
  private useRealAgent: boolean

  constructor(useRealAgent: boolean = false) {
    this.useRealAgent = useRealAgent
  }

  async execute(stage: TeamRunStage, context: ExecutionContext): Promise<StageResult> {
    this.currentStageId = stage.id
    this.state = 'running'

    const startTime = Date.now()

    try {
      let output: string

      if (this.useRealAgent) {
        output = await this.executeWithClaudeSDK(stage, context)
      } else {
        output = `Executed task: ${stage.task}`
      }

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

      console.error('[StageWorker] Execution error:', error)
      const sanitized = ErrorSanitizer.sanitize(error instanceof Error ? error : new Error('Unknown error'))

      return {
        stageId: stage.id,
        status: 'failed',
        output: '',
        artifacts: [],
        error: sanitized.userMessage,
        duration: Date.now() - startTime,
        metrics: {
          agentStartTime: startTime,
          agentEndTime: Date.now()
        }
      }
    }
  }

  private async executeWithClaudeSDK(stage: TeamRunStage, context: ExecutionContext): Promise<string> {
    const { ClaudeAgent } = await import('@anthropic-ai/claude-agent-sdk')

    // 配置安全策略
    const fileGuard = new FileAccessGuard({
      allowedPaths: [
        context.workspace.stageWorkDir,
        context.workspace.sharedReadDir,
        context.workspace.outputDir
      ],
      deniedPaths: []
    })

    const commandGuard = new CommandGuard({
      allowedCommands: ['git', 'npm', 'node', 'cat', 'ls', 'grep', 'find', 'echo', 'pwd']
    })

    // 应用文件访问控制
    // TODO: FileAccessGuard causes "Cannot set property" error in current Node.js version
    // fileGuard.wrapFileSystem()

    const prompt = this.buildPrompt(stage, context)

    try {
      const agent = await ClaudeAgent.create({
        sessionId: stage.id,
        workingDirectory: context.workspace.stageWorkDir,
        systemPrompt: `You are ${stage.roleId}. Execute the following task.`
      })

      const result = await agent.run(prompt)
      await agent.destroy()

      // 恢复文件系统
      // fileGuard.unwrapFileSystem()

      return result
    } catch (error) {
      // fileGuard.unwrapFileSystem()
      throw error
    }
  }

  private buildPrompt(stage: TeamRunStage, context: ExecutionContext): string {
    let prompt = `Task: ${stage.task}\n\n`

    if (context.dependencies.length > 0) {
      prompt += 'Dependencies:\n'
      context.dependencies.forEach(dep => {
        prompt += `- ${dep.stageId}: ${dep.output.slice(0, 200)}...\n`
      })
      prompt += '\n'
    }

    return prompt
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
