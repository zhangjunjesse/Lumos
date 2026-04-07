import type { CompiledStageV1 } from './compiler'
import type { WorkflowKnowledgeConfig } from '@/lib/workflow/types'

export interface WorkspaceBindingV1 {
  sessionWorkspace: string
  runWorkspace: string
  stageWorkspace: string
  sharedReadDir: string
  artifactOutputDir: string
}

export interface AgentExecutionBindingV1 {
  agentDefinitionId: string
  agentType: string
  roleName: string
  systemPrompt: string
  allowedTools: string[]
  capabilityTags: string[]
  memoryPolicy: 'ephemeral-stage' | 'sticky-run'
  outputSchema: 'stage-execution-result/v1'
  concurrencyLimit: number
  presetId?: string
}

export interface DependencyResultRefV1 {
  stageId: string
  title: string
  summary: string
  artifactRefs: string[]
}

export interface StageExecutionPayloadV1 {
  contractVersion: 'stage-execution-payload/v1'
  taskId: string
  sessionId: string
  requestedModel?: string
  runId: string
  stageId: string
  attempt: number
  workspace: WorkspaceBindingV1
  agent: AgentExecutionBindingV1
  taskContext: {
    userGoal: string
    summary: string
    expectedOutcome: string
  }
  stage: {
    title: string
    description: string
    acceptanceCriteria: string[]
    responseMode?: 'structured' | 'plain-text'
    inputContract: CompiledStageV1['inputContract']
    outputContract: CompiledStageV1['outputContract']
  }
  dependencies: DependencyResultRefV1[]
  memoryRefs: {
    taskMemoryId: string
    plannerMemoryId: string
    agentMemoryId: string
  }
  /** 步骤级别知识库访问配置(仅 workflow agent 步骤使用,可选) */
  knowledgeConfig?: WorkflowKnowledgeConfig
}

export interface StageExecutionArtifactV1 {
  kind: 'file' | 'log' | 'metadata' | 'report'
  title: string
  artifactId?: string
  relativePath?: string
  contentType?: string
  sizeBytes?: number
}

export interface StageExecutionResultV1 {
  contractVersion: 'stage-execution-result/v1'
  runId: string
  stageId: string
  attempt: number
  outcome: 'done' | 'failed' | 'blocked'
  summary: string
  detailArtifactRef?: string
  detailArtifactPath?: string
  artifacts: StageExecutionArtifactV1[]
  error?: {
    code: string
    message: string
    retryable: boolean
  }
  diagnostics?: {
    errorName?: string
    errorCode?: string
    sanitizedMessage?: string
    rawMessage?: string
    stack?: string
    cause?: string
    stderr?: string
    outputPreview?: string
    structuredOutputPreview?: string
    executionCwd?: string
    roleName?: string
    agentType?: string
    allowedRuntimeTools?: string[]
    allowedClaudeTools?: string[]
    dependencyCount?: number
  }
  memoryAppend?: Array<{
    scope: 'agent'
    content: string
  }>
  metrics: {
    startedAt: string
    finishedAt: string
    durationMs: number
    tokensUsed?: number
    apiCalls?: number
  }
}

export interface FinalSummaryPayloadV1 {
  contractVersion: 'final-summary-payload/v1'
  taskId: string
  sessionId: string
  runId: string
  userGoal: string
  expectedOutcome: string
  stageResults: Array<{
    stageId: string
    title: string
    status: 'done' | 'failed' | 'blocked' | 'cancelled'
    summary: string
    artifactRefs: string[]
  }>
  runSummary: string
}

export interface FinalSummaryResultV1 {
  contractVersion: 'final-summary-result/v1'
  runId: string
  finalSummary: string
  keyOutputs: string[]
  publishableMessage: string
}
