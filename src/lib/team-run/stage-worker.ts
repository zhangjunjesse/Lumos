import { ErrorSanitizer } from './security/error-sanitizer'
import { buildClaudeSdkRuntimeBootstrap } from '@/lib/claude/sdk-runtime'
import type { StageExecutionPayloadV1, StageExecutionResultV1 } from './runtime-contracts'
import {
  buildStageExecutionOutputSchema,
  normalizeStageExecutionResult,
  parseStageExecutionModelOutput,
} from './runtime-result-normalizer'
import { buildStageRuntimeToolPolicy, createStageCanUseTool, getStageExecutionCwd } from './runtime-tool-policy'

interface WorkerStatus {
  stageId: string
  state: 'idle' | 'preparing' | 'running' | 'finishing' | 'cancelled'
  progress?: number
}

type StageWorkerDiagnosticError = Error & {
  code?: string
  stderr?: string
  cause?: unknown
  outputPreview?: string
  structuredOutputPreview?: string
}

function truncateDiagnostic(value: string | undefined, maxLength: number = 4000): string | undefined {
  const normalized = value?.trim()
  if (!normalized) return undefined
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

function stringifyDiagnosticValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') {
    return truncateDiagnostic(ErrorSanitizer.sanitizeText(value))
  }

  try {
    return truncateDiagnostic(ErrorSanitizer.sanitizeText(JSON.stringify(value, null, 2)))
  } catch {
    return truncateDiagnostic(ErrorSanitizer.sanitizeText(String(value)))
  }
}

export class StageWorker {
  private currentStageId: string = ''
  private state: WorkerStatus['state'] = 'idle'
  private useRealAgent: boolean

  constructor(useRealAgent: boolean = false) {
    this.useRealAgent = useRealAgent
  }

  async execute(payload: StageExecutionPayloadV1): Promise<StageExecutionResultV1> {
    this.currentStageId = payload.stageId
    this.state = 'running'

    const startTime = Date.now()
    const startedAt = new Date(startTime).toISOString()

    try {
      if (this.useRealAgent) {
        const result = await this.executeWithClaudeSDK(payload, startTime, startedAt)
        this.state = 'idle'
        return result
      }

      const output = `Executed task: ${payload.stage.description || payload.stage.title}`
      const result = this.buildSyntheticSuccessResult(payload, output, startedAt, startTime)
      this.state = 'idle'
      return result
    } catch (error) {
      this.state = 'idle'

      const diagnostics = this.buildDiagnostics(payload, error)
      console.error(`[StageWorker] Execution error ${payload.stageId}: ${JSON.stringify(diagnostics)}`)
      const sanitized = ErrorSanitizer.sanitize(error instanceof Error ? error : new Error('Unknown error'))

      return {
        contractVersion: 'stage-execution-result/v1',
        runId: payload.runId,
        stageId: payload.stageId,
        attempt: payload.attempt,
        outcome: 'failed',
        summary: '',
        artifacts: [],
        error: {
          code: 'execution_failed',
          message: sanitized.userMessage,
          retryable: true,
        },
        diagnostics,
        memoryAppend: [{
          scope: 'agent',
          content: `Failed ${payload.stage.title}\n${sanitized.userMessage}`,
        }],
        metrics: {
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        },
      }
    }
  }

  private buildSyntheticSuccessResult(
    payload: StageExecutionPayloadV1,
    output: string,
    startedAt: string,
    startTime: number,
  ): StageExecutionResultV1 {
    return {
      contractVersion: 'stage-execution-result/v1',
      runId: payload.runId,
      stageId: payload.stageId,
      attempt: payload.attempt,
      outcome: 'done',
      summary: output,
      artifacts: [],
      memoryAppend: [{
        scope: 'agent',
        content: `Completed ${payload.stage.title}\n${output.trim()}`,
      }],
      metrics: {
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      },
    }
  }

  private buildDiagnostics(
    payload: StageExecutionPayloadV1,
    error: unknown,
  ): NonNullable<StageExecutionResultV1['diagnostics']> {
    const runtimePolicy = buildStageRuntimeToolPolicy(payload.agent)
    const normalizedError = error instanceof Error
      ? error as StageWorkerDiagnosticError
      : new Error(String(error)) as StageWorkerDiagnosticError
    const sanitized = ErrorSanitizer.sanitize(normalizedError)

    return {
      errorName: normalizedError.name || 'Error',
      ...(typeof normalizedError.code === 'string' ? { errorCode: normalizedError.code } : {}),
      sanitizedMessage: sanitized.userMessage,
      rawMessage: ErrorSanitizer.sanitizeText(normalizedError.message || String(error)),
      ...(truncateDiagnostic(stringifyDiagnosticValue(normalizedError.stack)) ? { stack: truncateDiagnostic(stringifyDiagnosticValue(normalizedError.stack)) } : {}),
      ...(stringifyDiagnosticValue(normalizedError.cause) ? { cause: stringifyDiagnosticValue(normalizedError.cause) } : {}),
      ...(truncateDiagnostic(stringifyDiagnosticValue(normalizedError.stderr)) ? { stderr: truncateDiagnostic(stringifyDiagnosticValue(normalizedError.stderr)) } : {}),
      ...(truncateDiagnostic(stringifyDiagnosticValue(normalizedError.outputPreview)) ? { outputPreview: truncateDiagnostic(stringifyDiagnosticValue(normalizedError.outputPreview)) } : {}),
      ...(truncateDiagnostic(stringifyDiagnosticValue(normalizedError.structuredOutputPreview)) ? { structuredOutputPreview: truncateDiagnostic(stringifyDiagnosticValue(normalizedError.structuredOutputPreview)) } : {}),
      executionCwd: getStageExecutionCwd(payload),
      roleName: payload.agent.roleName,
      agentType: payload.agent.agentType,
      allowedRuntimeTools: [...payload.agent.allowedTools],
      allowedClaudeTools: [...runtimePolicy.sdkTools],
      dependencyCount: payload.dependencies.length,
    }
  }

  private async executeWithClaudeSDK(
    payload: StageExecutionPayloadV1,
    startTime: number,
    startedAt: string,
  ): Promise<StageExecutionResultV1> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    const prompt = this.buildPrompt(payload)
    const runtimePolicy = buildStageRuntimeToolPolicy(payload.agent)
    const runtimeBootstrap = buildClaudeSdkRuntimeBootstrap()
    let stderrOutput = ''
    let output = ''
    let structuredOutput: unknown

    try {
      const queryResult = query({
        prompt,
        options: {
          cwd: getStageExecutionCwd(payload),
          systemPrompt: payload.agent.systemPrompt,
          tools: runtimePolicy.sdkTools,
          allowedTools: runtimePolicy.allowedTools,
          canUseTool: createStageCanUseTool(payload),
          permissionMode: 'dontAsk',
          env: runtimeBootstrap.env,
          settingSources: runtimeBootstrap.settingSources,
          stderr: (data) => {
            stderrOutput += data
          },
          ...(runtimeBootstrap.pathToClaudeCodeExecutable
            ? { pathToClaudeCodeExecutable: runtimeBootstrap.pathToClaudeCodeExecutable }
            : {}),
          outputFormat: {
            type: 'json_schema',
            schema: buildStageExecutionOutputSchema(),
          },
        },
      })

      for await (const message of queryResult) {
        if ((message as any).text) {
          output += (message as any).text
        }
        if ((message as any).type === 'result' && (message as any).structured_output) {
          structuredOutput = (message as any).structured_output
        }
      }

      if (!structuredOutput) {
        const missingOutputError = new Error('Claude SDK did not return structured stage output') as StageWorkerDiagnosticError
        missingOutputError.outputPreview = truncateDiagnostic(output)
        throw missingOutputError
      }

      let normalized: StageExecutionResultV1
      try {
        normalized = normalizeStageExecutionResult({
          payload,
          modelOutput: parseStageExecutionModelOutput(structuredOutput),
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        })
      } catch (error) {
        if (error instanceof Error) {
          const diagnosticError = error as StageWorkerDiagnosticError
          diagnosticError.outputPreview = truncateDiagnostic(output)
          diagnosticError.structuredOutputPreview = stringifyDiagnosticValue(structuredOutput)
        }
        throw error
      }

      if (normalized.memoryAppend?.length) {
        return normalized
      }

      return {
        ...normalized,
        memoryAppend: [{
          scope: 'agent',
          content: `Completed ${payload.stage.title}\n${normalized.summary.trim() || output.trim()}`,
        }],
      }
    } catch (error) {
      if (error instanceof Error) {
        const diagnosticError = error as StageWorkerDiagnosticError
        if (stderrOutput.trim()) {
          diagnosticError.stderr = ErrorSanitizer.sanitizeText(stderrOutput.trim())
        }
        if (output.trim() && !diagnosticError.outputPreview) {
          diagnosticError.outputPreview = truncateDiagnostic(output)
        }
        if (structuredOutput !== undefined && !diagnosticError.structuredOutputPreview) {
          diagnosticError.structuredOutputPreview = stringifyDiagnosticValue(structuredOutput)
        }
      }
      throw error
    }
  }

  private buildPrompt(payload: StageExecutionPayloadV1): string {
    const runtimePolicy = buildStageRuntimeToolPolicy(payload.agent)
    const header = [
      `Run: ${payload.runId}`,
      `Stage: ${payload.stage.title}`,
      `Attempt: ${payload.attempt}`,
      `Role: ${payload.agent.roleName} (${payload.agent.agentType})`,
    ]

    const context = [
      '# Task Context',
      `User Goal: ${payload.taskContext.userGoal || 'N/A'}`,
      `Summary: ${payload.taskContext.summary || 'N/A'}`,
      `Expected Outcome: ${payload.taskContext.expectedOutcome || 'N/A'}`,
    ]

    const stage = [
      '# Stage Contract',
      `Title: ${payload.stage.title}`,
      `Description: ${payload.stage.description || 'N/A'}`,
      `Acceptance Criteria: ${payload.stage.acceptanceCriteria.join(' | ') || 'N/A'}`,
      `Primary Format: ${payload.stage.outputContract.primaryFormat}`,
      `Artifacts Allowed: ${payload.stage.outputContract.artifactKinds.join(', ') || 'none'}`,
      `Must Produce Summary: ${payload.stage.outputContract.mustProduceSummary ? 'yes' : 'no'}`,
      `May Produce Artifacts: ${payload.stage.outputContract.mayProduceArtifacts ? 'yes' : 'no'}`,
    ]

    const agentPolicy = [
      '# Agent Contract',
      `Capability Tags: ${payload.agent.capabilityTags.join(', ') || 'none'}`,
      `Allowed Runtime Capabilities: ${payload.agent.allowedTools.join(', ') || 'none'}`,
      `Allowed Claude Tools: ${runtimePolicy.sdkTools.join(', ') || 'none'}`,
      `Output Schema: ${payload.agent.outputSchema}`,
      `Memory Policy: ${payload.agent.memoryPolicy}`,
      `Concurrency Limit: ${payload.agent.concurrencyLimit}`,
      'Return the final stage result as structured JSON matching stage-execution-result/v1.',
      ...(payload.agent.presetId ? [`Preset: ${payload.agent.presetId}`] : []),
      ...(runtimePolicy.unmappedCapabilities.length > 0
        ? [`Unmapped Capabilities: ${runtimePolicy.unmappedCapabilities.join(', ')}`]
        : []),
    ]

    const dependencies = payload.dependencies.length > 0
      ? [
          '# Dependencies',
          ...payload.dependencies.map((dependency) => (
            `- ${dependency.title} (${dependency.stageId}): ${dependency.summary}${dependency.artifactRefs.length > 0 ? ` [artifacts: ${dependency.artifactRefs.join(', ')}]` : ''}`
          )),
        ]
      : ['# Dependencies', 'None']

    const memoryRefs = [
      '# Memory Refs',
      `Task Memory: ${payload.memoryRefs.taskMemoryId}`,
      `Planner Memory: ${payload.memoryRefs.plannerMemoryId}`,
      `Agent Memory: ${payload.memoryRefs.agentMemoryId}`,
    ]

    const workspaces = [
      '# Workspace',
      `Session Workspace: ${payload.workspace.sessionWorkspace}`,
      `Run Workspace: ${payload.workspace.runWorkspace}`,
      `Stage Workspace: ${payload.workspace.stageWorkspace}`,
      `Execution CWD: ${getStageExecutionCwd(payload)}`,
      `Shared Read Dir: ${payload.workspace.sharedReadDir}`,
      `Artifact Output Dir: ${payload.workspace.artifactOutputDir}`,
      'Write any stage artifacts under Artifact Output Dir and reference them by relative path only.',
    ]

    return [
      header.join('\n'),
      context.join('\n'),
      stage.join('\n'),
      agentPolicy.join('\n'),
      dependencies.join('\n'),
      memoryRefs.join('\n'),
      workspaces.join('\n'),
    ].join('\n\n')
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
