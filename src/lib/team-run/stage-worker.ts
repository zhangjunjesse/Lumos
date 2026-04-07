import * as fs from 'fs'
import * as path from 'path'
import { ErrorSanitizer } from './security/error-sanitizer'
import { buildClaudeSdkRuntimeBootstrap } from '@/lib/claude/sdk-runtime'
import { ensureClaudeLocalAuthReady } from '@/lib/claude/local-auth'
import type { ApiProvider } from '@/types'
import type { StageExecutionPayloadV1, StageExecutionResultV1 } from './runtime-contracts'
import {
  buildStageExecutionOutputSchema,
  normalizeStageExecutionResult,
  parseStageExecutionModelOutput,
} from './runtime-result-normalizer'
import { buildStageRuntimeToolPolicy, getStageExecutionCwd } from './runtime-tool-policy'
import { resolveEnabledMcpServers, toSdkMcpConfig } from '@/lib/mcp-resolver'
import { createKnowledgeMcpServer } from '@/lib/knowledge/workflow-knowledge-tool'
import {
  buildKnowledgePromptSection,
  KNOWLEDGE_MCP_SERVER_NAME,
} from '@/lib/knowledge/workflow-prompt-section'
import { resolveTagNames, listTagCatalog } from '@/lib/knowledge/tag-resolver'

interface WorkerStatus {
  stageId: string
  state: 'idle' | 'preparing' | 'running' | 'finishing' | 'cancelled'
  progress?: number
}

interface StageWorkerExecuteOptions {
  abortController?: AbortController
  provider?: ApiProvider
  onTraceEvent?: (event: unknown) => void
}

type StageWorkerDiagnosticError = Error & {
  code?: string
  stderr?: string
  cause?: unknown
  outputPreview?: string
  structuredOutputPreview?: string
}

/** Shape of messages emitted by the Claude Agent SDK query stream. */
interface SdkQueryMessage {
  type?: string
  text?: string
  result?: string
  structured_output?: unknown
}

function listDirFilesSync(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => e.isFile() && !e.name.startsWith('.'))
      .map(e => e.name)
      .sort()
  } catch {
    return []
  }
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

function buildAbortError(message: string = 'Task execution cancelled'): StageWorkerDiagnosticError {
  const error = new Error(message) as StageWorkerDiagnosticError
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown }
  return (
    candidate.name === 'AbortError'
    || candidate.code === 'ABORT_ERR'
    || candidate.code === 'ERR_CANCELED'
  )
}

function isRetryableApiError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  const code = (error as { code?: string }).code ?? ''
  // HTTP 429 rate limit
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')) return true
  // HTTP 5xx server errors
  if (/\b5\d{2}\b/.test(msg) || msg.includes('internal server error') || msg.includes('bad gateway') || msg.includes('service unavailable')) return true
  // Network errors
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || msg.includes('network') || msg.includes('socket hang up')) return true
  // Anthropic overloaded
  if (msg.includes('overloaded') || msg.includes('capacity')) return true
  return false
}


function isTextOnlyStageContract(payload: StageExecutionPayloadV1): boolean {
  return !payload.stage.outputContract.mayProduceArtifacts
    && payload.stage.outputContract.artifactKinds.length === 0
}

function prefersPlainTextStageResult(payload: StageExecutionPayloadV1): boolean {
  return payload.stage.responseMode === 'plain-text' && isTextOnlyStageContract(payload)
}

export class StageWorker {
  private currentStageId: string = ''
  private state: WorkerStatus['state'] = 'idle'
  private useRealAgent: boolean
  private abortController: AbortController | null = null

  constructor(useRealAgent: boolean = false) {
    this.useRealAgent = useRealAgent
  }

  private isCancelled(): boolean {
    return this.state === 'cancelled' || Boolean(this.abortController?.signal.aborted)
  }

  async execute(
    payload: StageExecutionPayloadV1,
    options: StageWorkerExecuteOptions = {},
  ): Promise<StageExecutionResultV1> {
    this.currentStageId = payload.stageId
    this.state = 'running'
    this.abortController = options.abortController ?? new AbortController()

    const startTime = Date.now()
    const startedAt = new Date(startTime).toISOString()

    try {
      if (this.abortController.signal.aborted) {
        throw buildAbortError()
      }

      if (this.useRealAgent) {
        const result = await this.executeWithRetry(payload, startTime, startedAt, options.provider, options.onTraceEvent)
        if (!this.isCancelled()) {
          this.state = 'idle'
        }
        return result
      }

      const output = `Executed task: ${payload.stage.description || payload.stage.title}`
      const result = this.buildSyntheticSuccessResult(payload, output, startedAt, startTime)
      if (!this.isCancelled()) {
        this.state = 'idle'
      }
      return result
    } catch (error) {
      const cancelled = this.isCancelled() || isAbortError(error)

      if (!cancelled) {
        this.state = 'idle'
      }

      const diagnostics = this.buildDiagnostics(payload, error)
      if (cancelled) {
        return {
          contractVersion: 'stage-execution-result/v1',
          runId: payload.runId,
          stageId: payload.stageId,
          attempt: payload.attempt,
          outcome: 'failed',
          summary: '',
          artifacts: [],
          error: {
            code: 'execution_cancelled',
            message: 'Task execution cancelled',
            retryable: false,
          },
          diagnostics,
          memoryAppend: [],
          metrics: {
            startedAt,
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - startTime,
          },
        }
      }

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
    } finally {
      this.abortController = null
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

  private async executeWithRetry(
    payload: StageExecutionPayloadV1,
    startTime: number,
    startedAt: string,
    provider?: ApiProvider,
    onTraceEvent?: (event: unknown) => void,
  ): Promise<StageExecutionResultV1> {
    const MAX_API_RETRIES = 3
    for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
      try {
        return await this.executeWithClaudeSDK(payload, startTime, startedAt, provider, onTraceEvent)
      } catch (error) {
        if (this.isCancelled() || isAbortError(error)) throw error
        if (attempt < MAX_API_RETRIES && isRetryableApiError(error)) {
          const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000)
          console.warn(`[StageWorker] Retryable API error (attempt ${attempt}/${MAX_API_RETRIES}), retrying in ${delay}ms:`, error instanceof Error ? error.message : error)
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        throw error
      }
    }
    throw new Error('Unexpected: retry loop exited without result')
  }

  private async executeWithClaudeSDK(
    payload: StageExecutionPayloadV1,
    startTime: number,
    startedAt: string,
    provider?: ApiProvider,
    onTraceEvent?: (event: unknown) => void,
  ): Promise<StageExecutionResultV1> {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    const prompt = this.buildPrompt(payload)
    const runtimeBootstrap = buildClaudeSdkRuntimeBootstrap({
      provider,
      sessionId: payload.sessionId,
    })
    await ensureClaudeLocalAuthReady(runtimeBootstrap.activeProvider)
    const requestedModel = payload.requestedModel?.trim() || undefined
    let stderrOutput = ''
    let output = ''
    let structuredOutput: unknown

    // Load MCP servers so workflow agents can use DeepSearch, Feishu, etc.
    const lumosMcpServers = resolveEnabledMcpServers({
      sessionWorkingDirectory: getStageExecutionCwd(payload),
      sessionId: payload.sessionId,
    })
    const stdioMcpServers = lumosMcpServers ? toSdkMcpConfig(lumosMcpServers) : undefined

    // Knowledge base tool (in-process) — only when step explicitly enables it
    let knowledgeSystemPromptSuffix = ''
    let knowledgeInProcessServer: Record<string, ReturnType<typeof createKnowledgeMcpServer>> | undefined
    if (payload.knowledgeConfig?.enabled) {
      const cfg = payload.knowledgeConfig
      const resolved = resolveTagNames(cfg.defaultTagNames ?? [])
      const catalog = cfg.allowAgentTagSelection ? listTagCatalog({ limit: 30 }) : undefined
      knowledgeSystemPromptSuffix = buildKnowledgePromptSection({
        config: cfg,
        resolvedTagNames: resolved.tags.map((t) => t.name),
        missingTagNames: resolved.missing,
        catalog,
      })
      knowledgeInProcessServer = {
        [KNOWLEDGE_MCP_SERVER_NAME]: createKnowledgeMcpServer(cfg),
      }
    }

    const mergedMcpServers = (stdioMcpServers || knowledgeInProcessServer)
      ? { ...(stdioMcpServers ?? {}), ...(knowledgeInProcessServer ?? {}) }
      : undefined

    const effectiveSystemPrompt = knowledgeSystemPromptSuffix
      ? `${payload.agent.systemPrompt}${knowledgeSystemPromptSuffix}`
      : payload.agent.systemPrompt

    const baseQueryOptions = {
      abortController: this.abortController ?? new AbortController(),
      cwd: getStageExecutionCwd(payload),
      systemPrompt: effectiveSystemPrompt,
      permissionMode: 'bypassPermissions' as const,
      env: runtimeBootstrap.env,
      settingSources: runtimeBootstrap.settingSources,
      ...(requestedModel ? { model: requestedModel } : {}),
      ...(mergedMcpServers ? { mcpServers: mergedMcpServers } : {}),
      stderr: (data: string) => {
        stderrOutput += data
      },
      ...(runtimeBootstrap.pathToClaudeCodeExecutable
        ? { pathToClaudeCodeExecutable: runtimeBootstrap.pathToClaudeCodeExecutable }
        : {}),
    }

    try {
      if (prefersPlainTextStageResult(payload)) {
        const plainTextResult = await this.executePlainTextMode({
          query,
          payload,
          prompt,
          baseQueryOptions,
          startedAt,
          startTime,
          onTraceEvent,
        })

        if (!plainTextResult) {
          const missingOutputError = new Error('Claude SDK did not return plain-text stage output') as StageWorkerDiagnosticError
          missingOutputError.outputPreview = truncateDiagnostic(output)
          throw missingOutputError
        }

        return plainTextResult
      }

      const queryResult = query({
        prompt,
        options: {
          ...baseQueryOptions,
          outputFormat: {
            type: 'json_schema',
            schema: buildStageExecutionOutputSchema(),
          },
        },
      })

      for await (const message of queryResult) {
        const msg = message as SdkQueryMessage
        const msgType: string = msg.type ?? ''
        if (onTraceEvent && (msgType === 'assistant' || msgType === 'user')) {
          onTraceEvent(message)
        }
        if (msg.text) {
          output += msg.text
        }
        if (msgType === 'result' && typeof msg.result === 'string' && !msg.structured_output) {
          output += msg.result
        }
        if (msgType === 'result' && msg.structured_output) {
          structuredOutput = msg.structured_output
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
          modelOutput: parseStageExecutionModelOutput(structuredOutput, payload.workspace.artifactOutputDir),
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

  private async executePlainTextMode(input: {
    query: (params: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<unknown>
    payload: StageExecutionPayloadV1
    prompt: string
    baseQueryOptions: Record<string, unknown>
    startedAt: string
    startTime: number
    onTraceEvent?: (event: unknown) => void
  }): Promise<StageExecutionResultV1 | null> {
    const {
      query,
      payload,
      prompt,
      baseQueryOptions,
      startedAt,
      startTime,
      onTraceEvent,
    } = input

    let output = ''
    let stderrOutput = ''
    const plainTextPrompt = [
      prompt,
      '# Plain-Text Delivery Mode',
      'Return only the final deliverable text for this stage.',
      'Do not return JSON.',
      'Do not mention any schema or formatting rules.',
      'Do not create or declare any artifacts. The artifacts array will be forced to empty by runtime.',
    ].join('\n\n')

    try {
      const queryResult = query({
        prompt: plainTextPrompt,
        options: {
          ...baseQueryOptions,
          stderr: (data: string) => {
            stderrOutput += data
          },
        },
      })

      for await (const message of queryResult as AsyncIterable<SdkQueryMessage>) {
        const msg = message
        const msgType: string = msg.type ?? ''
        if (onTraceEvent && (msgType === 'assistant' || msgType === 'user')) {
          onTraceEvent(message)
        }
        if (msg.text) {
          output += msg.text
        }
        if (msgType === 'result' && typeof msg.result === 'string') {
          output += msg.result
        }
      }

      const summary = output.trim()
      if (!summary) {
        return null
      }

      return {
        contractVersion: 'stage-execution-result/v1',
        runId: payload.runId,
        stageId: payload.stageId,
        attempt: payload.attempt,
        outcome: 'done',
        summary,
        artifacts: [],
        diagnostics: {
          errorName: 'PlainTextDeliveryMode',
          sanitizedMessage: 'Plain-text delivery mode used',
          rawMessage: 'Runtime requested plain-text stage delivery',
          ...(stderrOutput.trim() ? { stderr: ErrorSanitizer.sanitizeText(stderrOutput.trim()) } : {}),
          executionCwd: getStageExecutionCwd(payload),
          roleName: payload.agent.roleName,
          agentType: payload.agent.agentType,
          allowedRuntimeTools: [...payload.agent.allowedTools],
          allowedClaudeTools: [...buildStageRuntimeToolPolicy(payload.agent).sdkTools],
          dependencyCount: payload.dependencies.length,
        },
        memoryAppend: [{
          scope: 'agent',
          content: `Completed ${payload.stage.title}\n${summary}`,
        }],
        metrics: {
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startTime,
        },
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
      ...(prefersPlainTextStageResult(payload)
        ? [
            'Return only the final deliverable text for this stage.',
            'Do not return JSON.',
          ]
        : ['Return the final stage result as structured JSON matching stage-execution-result/v1.']),
      ...(payload.agent.presetId ? [`Preset: ${payload.agent.presetId}`] : []),
      ...(runtimePolicy.unmappedCapabilities.length > 0
        ? [`Unmapped Capabilities: ${runtimePolicy.unmappedCapabilities.join(', ')}`]
        : []),
    ]

    const runId = payload.runId
    const stageId = payload.stageId

    const ioContract = [
      '# I/O Contract',
      '',
      '## Inputs',
      `- Run ID: ${runId}`,
      `- Stage ID: ${stageId}`,
      ...(payload.dependencies.length > 0
        ? [
            '- Upstream stage outputs:',
            ...payload.dependencies.flatMap((dep) => {
              const summaryFile = `${payload.workspace.sharedReadDir}/${runId}_${dep.stageId}_output.md`
              const lines = [
                `  • **${dep.stageId}**: ${dep.summary.slice(0, 200)}${dep.summary.length > 200 ? '…' : ''}`,
                `    Summary file: ${summaryFile}`,
              ]
              const upstreamOutputDir = path.join(payload.workspace.runWorkspace, 'stages', dep.stageId, 'output')
              const artifactFiles = listDirFilesSync(upstreamOutputDir)
              if (artifactFiles.length > 0) {
                lines.push(`    **完整产出物文件（优先读取这些文件获取完整内容，不要只依赖 summary）**:`)
                for (const f of artifactFiles) {
                  lines.push(`      - ${path.join(upstreamOutputDir, f)}`)
                }
              }
              return lines
            }),
            '',
            '**重要：如果上游步骤有产出物文件，必须读取这些文件获取完整原始内容进行分析，不要仅依赖 summary 摘要。**',
          ]
        : ['- No upstream dependencies']),
      '',
      '## Outputs',
      '- Required: Return a text summary as your structured result (will be passed to downstream stages)',
      `- **所有报告、文档、分析结果等文件必须写入**: ${payload.workspace.artifactOutputDir}`,
      `- 文件命名规范: ${runId}_${stageId}_<描述>.<ext>`,
      `- 禁止写入 shared 目录 (${payload.workspace.sharedReadDir})，shared 目录由运行时自动管理`,
      '- Do NOT write files outside your artifact output dir',
      '',
      '## Stage Boundary',
      `Execute ONLY the work for stage "${stageId}". Stop when done. Do NOT do work that belongs to other stages.`,
    ]

    const dependencies = payload.dependencies.length > 0
      ? [
          '# Dependencies (full context)',
          ...payload.dependencies.map((dependency) => (
            `- ${dependency.title} (${dependency.stageId}): ${dependency.summary}${dependency.artifactRefs.length > 0 ? ` [artifacts: ${dependency.artifactRefs.join(', ')}]` : ''}`
          )),
        ]
      : []

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
      payload.stage.outputContract.mayProduceArtifacts
        ? 'Write any stage artifacts under Artifact Output Dir and reference them by relative path only.'
        : 'Do not create or declare any artifacts for this stage. Return an empty artifacts array.',
    ]

    return [
      header.join('\n'),
      ioContract.join('\n'),
      context.join('\n'),
      stage.join('\n'),
      agentPolicy.join('\n'),
      ...(dependencies.length > 0 ? [dependencies.join('\n')] : []),
      memoryRefs.join('\n'),
      workspaces.join('\n'),
    ].join('\n\n')
  }

  async cancel(): Promise<void> {
    this.state = 'cancelled'
    this.abortController?.abort()
  }

  getStatus(): WorkerStatus {
    return {
      stageId: this.currentStageId,
      state: this.state
    }
  }
}
