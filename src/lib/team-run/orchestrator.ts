import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomBytes } from 'crypto'
import { ConcurrencyController } from './concurrency-controller'
import { parseCompiledRunPlan, type CompiledRunPlanV1, type CompiledRoleV1, type CompiledStageV1 } from './compiler'
import { createFinalSummaryResult } from './final-summary'
import type {
  AgentExecutionBindingV1,
  DependencyResultRefV1,
  FinalSummaryPayloadV1,
  StageExecutionPayloadV1,
  StageExecutionResultV1,
} from './runtime-contracts'
import { StageWorker } from './stage-worker'
import { StateManager } from './state-manager'
import { WorkspaceManager } from './workspace-manager'
import { publishTeamRunChatUpdate } from './chat-sync'

type RunStatus = 'pending' | 'ready' | 'running' | 'paused' | 'cancelling' | 'cancelled' | 'summarizing' | 'done' | 'failed'
type PublicRunStatus = RunStatus | 'blocked'
type StageStatusType = 'pending' | 'ready' | 'running' | 'waiting' | 'blocked' | 'done' | 'failed' | 'cancelled'

interface TeamRunStatus {
  runId: string
  planId: string
  status: PublicRunStatus
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

interface StageRow {
  id: string
  run_id: string
  name: string
  role_id: string
  task: string
  description?: string | null
  owner_agent_type?: string | null
  agent_definition_id?: string | null
  status: StageStatusType
  dependencies: string
  latest_result: string | null
  latest_result_ref?: string | null
  error: string | null
  last_error?: string | null
  retry_count: number
  last_attempt_id?: string | null
  started_at: number | null
  completed_at: number | null
  created_at: number
  updated_at: number
}

interface RunRow {
  id: string
  plan_id: string
  task_id: string | null
  session_id: string | null
  status: RunStatus
  compiled_plan_json: string
  summary: string
  final_summary: string
  error: string | null
  published_at: string | null
  projection_version: number
  created_at: number
  started_at: number | null
  completed_at: number | null
  pause_requested_at: number | null
  cancel_requested_at: number | null
}

type AttemptStatus = 'created' | 'running' | 'done' | 'failed' | 'cancelled'
type AgentInstanceStatus = 'allocated' | 'running' | 'completed' | 'failed' | 'released'
type MemoryOwnerType = 'task' | 'planner' | 'agent_instance'

interface AttemptRow {
  id: string
  run_id: string
  stage_id: string
  attempt_no: number
  agent_instance_id: string | null
  status: AttemptStatus
  result_summary: string
  result_artifact_id: string | null
  error_code: string | null
  error_message: string | null
  retryable: number
  started_at: number | null
  completed_at: number | null
  created_at: number
  updated_at: number
}

interface MemoryRow {
  id: string
  content: string
}

interface ArtifactRow {
  id: string
}

interface ExecutionBindings {
  attemptId: string
  attemptNo: number
  agentInstanceId: string
  taskMemoryId: string
  plannerMemoryId: string
  agentMemoryId: string
}

type WorkerFactory = () => StageWorker

function parseDependencies(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function buildRunSummary(stages: StageRow[]): string {
  const lines = stages.map((stage) => {
    const summary = stage.latest_result?.trim()
      || stage.error?.trim()
      || (stage.status === 'running' ? 'Stage is running.' : 'No output yet.')
    return `- [${stage.status}] ${stage.name}: ${summary}`
  })

  return lines.join('\n').trim()
}

function generateEventId(): string {
  return randomBytes(16).toString('hex')
}

function isTerminalRunStatus(status: RunStatus): boolean {
  return ['done', 'failed', 'cancelled'].includes(status)
}

function mapRunStatusToTaskStatus(status: RunStatus): 'in_progress' | 'completed' | 'failed' {
  if (status === 'done') return 'completed'
  if (status === 'failed' || status === 'cancelled') return 'failed'
  return 'in_progress'
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function truncateSummary(value: string, maxLength: number = 600): string {
  const normalized = value.trim()
  if (normalized.length <= maxLength) {
    return normalized
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`
}

function selectStageErrorMessage(result: StageExecutionResultV1): string {
  const fallback = result.error?.message
    || (result.outcome === 'blocked' ? (result.summary || 'Stage blocked') : 'Unknown error')
  const diagnosticMessage = result.diagnostics?.rawMessage?.trim()

  if (
    diagnosticMessage
    && (!fallback || fallback === 'Task execution failed' || fallback === 'Unknown error')
  ) {
    return truncateSummary(diagnosticMessage, 1000)
  }

  return truncateSummary(fallback, 1000)
}

function buildAttemptErrorMessage(result: StageExecutionResultV1, visibleError: string): string {
  const parts = [visibleError]

  if (result.diagnostics?.stderr?.trim()) {
    parts.push(`stderr:\n${result.diagnostics.stderr.trim()}`)
  }
  if (result.diagnostics?.outputPreview?.trim()) {
    parts.push(`output_preview:\n${result.diagnostics.outputPreview.trim()}`)
  }
  if (result.diagnostics?.structuredOutputPreview?.trim()) {
    parts.push(`structured_output_preview:\n${result.diagnostics.structuredOutputPreview.trim()}`)
  }

  return truncateSummary(parts.join('\n\n'), 4000)
}

export class TeamRunOrchestrator {
  private stateManager: StateManager
  private workspaceManager: WorkspaceManager
  private concurrencyController: ConcurrencyController
  private workerFactory: WorkerFactory
  private taskColumnCache: string[] | null = null

  constructor(
    private db: Database.Database,
    workspaceBaseDir?: string,
    maxConcurrency: number = 3,
    workerFactory?: WorkerFactory,
  ) {
    this.stateManager = new StateManager(db)
    this.workspaceManager = new WorkspaceManager(
      workspaceBaseDir || path.join(os.tmpdir(), 'team-runs'),
    )
    this.concurrencyController = new ConcurrencyController(maxConcurrency)
    this.workerFactory = workerFactory || (() => new StageWorker(true))
  }

  private recordEvent(runId: string, eventType: string, payload: Record<string, unknown> = {}, stageId?: string): void {
    this.db.prepare(`
      INSERT INTO team_run_events (id, run_id, stage_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      generateEventId(),
      runId,
      stageId || null,
      eventType,
      JSON.stringify(payload),
      Date.now(),
    )
  }

  private bumpRunProjectionVersion(runId: string): void {
    this.db.prepare(`
      UPDATE team_runs
      SET projection_version = projection_version + 1
      WHERE id = ?
    `).run(runId)
  }

  private updateRuntimeMeta(runId: string, mutate: (current: Record<string, unknown>) => Record<string, unknown>): void {
    const run = this.getRun(runId)
    if (!run?.compiled_plan_json) {
      return
    }

    try {
      const parsed = JSON.parse(run.compiled_plan_json) as unknown
      if (!isObjectRecord(parsed)) {
        return
      }

      const currentMeta = isObjectRecord(parsed.runtimeMeta) ? parsed.runtimeMeta : {}
      const nextPayload = {
        ...parsed,
        runtimeMeta: mutate({ ...currentMeta }),
      }

      this.db.prepare(`
        UPDATE team_runs
        SET compiled_plan_json = ?, projection_version = projection_version + 1
        WHERE id = ?
      `).run(JSON.stringify(nextPayload), runId)
    } catch {
      // Best effort only. Runtime control must not fail on non-critical meta sync.
    }
  }

  private getTaskColumns(): string[] {
    if (this.taskColumnCache) {
      return this.taskColumnCache
    }

    const rows = this.db.prepare(`PRAGMA table_info(tasks)`).all() as Array<{ name?: string }>
    this.taskColumnCache = rows
      .map((row) => row.name || '')
      .filter(Boolean)
    return this.taskColumnCache
  }

  private syncTaskProjection(run: RunRow, status: RunStatus, finalSummary: string): void {
    if (!run.task_id) {
      return
    }

    const columns = new Set(this.getTaskColumns())
    if (columns.size === 0) {
      return
    }

    const assignments: string[] = []
    const params: Array<string> = []

    if (columns.has('status')) {
      assignments.push('status = ?')
      params.push(mapRunStatusToTaskStatus(status))
    }

    if (columns.has('final_result_summary') && finalSummary.trim()) {
      assignments.push('final_result_summary = ?')
      params.push(finalSummary)
    }

    if (columns.has('updated_at')) {
      assignments.push(`updated_at = datetime('now')`)
    }

    if (columns.has('last_action_at')) {
      assignments.push(`last_action_at = datetime('now')`)
    }

    if (assignments.length === 0) {
      return
    }

    this.db.prepare(`
      UPDATE tasks
      SET ${assignments.join(', ')}
      WHERE id = ?
    `).run(...params, run.task_id)
  }

  private buildTaskContext(run: RunRow): { userGoal: string; summary: string; expectedOutcome: string } {
    const compiledPlan = parseCompiledRunPlan(run.compiled_plan_json)
    return {
      userGoal: compiledPlan?.publicTaskContext.userGoal || '',
      summary: compiledPlan?.publicTaskContext.summary || run.summary || '',
      expectedOutcome: compiledPlan?.publicTaskContext.expectedOutcome || '',
    }
  }

  private buildTaskMemoryContent(run: RunRow): string {
    const context = this.buildTaskContext(run)
    return [
      `User Goal: ${context.userGoal || 'N/A'}`,
      `Summary: ${context.summary || 'N/A'}`,
      `Expected Outcome: ${context.expectedOutcome || 'N/A'}`,
    ].join('\n')
  }

  private buildPlannerMemoryContent(run: RunRow): string {
    const context = this.buildTaskContext(run)
    return [
      `Run Summary: ${run.summary.trim() || context.summary || 'No summary yet.'}`,
      `Run Status: ${run.status}`,
    ].join('\n')
  }

  private buildAgentMemorySeed(stage: StageRow, attemptNo: number): string {
    return [
      `Stage: ${stage.name}`,
      `Attempt: ${attemptNo}`,
      `Task: ${(stage.description || stage.task || '').trim() || 'N/A'}`,
    ].join('\n')
  }

  private ensureMemorySpace(
    runId: string,
    ownerType: MemoryOwnerType,
    ownerId: string,
    initialContent: string,
    stageId?: string,
  ): string {
    const existing = this.db.prepare(`
      SELECT id, content
      FROM team_run_memories
      WHERE run_id = ? AND owner_type = ? AND owner_id = ?
      LIMIT 1
    `).get(runId, ownerType, ownerId) as MemoryRow | undefined

    if (existing) {
      if (!existing.content.trim() && initialContent.trim()) {
        this.db.prepare(`
          UPDATE team_run_memories
          SET content = ?, updated_at = ?
          WHERE id = ?
        `).run(initialContent, Date.now(), existing.id)
      }
      return existing.id
    }

    const memoryId = generateEventId()
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO team_run_memories (id, run_id, stage_id, owner_type, owner_id, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(memoryId, runId, stageId || null, ownerType, ownerId, initialContent, now, now)
    return memoryId
  }

  private appendMemoryContent(memoryId: string, content: string): void {
    const next = content.trim()
    if (!next) return

    const existing = this.db.prepare('SELECT content FROM team_run_memories WHERE id = ?').get(memoryId) as { content?: string } | undefined
    const merged = existing?.content?.trim()
      ? `${existing.content.trim()}\n\n${next}`
      : next

    this.db.prepare(`
      UPDATE team_run_memories
      SET content = ?, updated_at = ?
      WHERE id = ?
    `).run(merged, Date.now(), memoryId)
  }

  private getPendingAttempt(stageId: string): AttemptRow | undefined {
    return this.db.prepare(`
      SELECT *
      FROM team_run_stage_attempts
      WHERE stage_id = ? AND status = 'created'
      ORDER BY attempt_no DESC
      LIMIT 1
    `).get(stageId) as AttemptRow | undefined
  }

  private getNextAttemptNo(stageId: string): number {
    const row = this.db.prepare(`
      SELECT MAX(attempt_no) AS value
      FROM team_run_stage_attempts
      WHERE stage_id = ?
    `).get(stageId) as { value?: number | null } | undefined
    return Math.max(0, row?.value || 0) + 1
  }

  private createAttempt(runId: string, stageId: string, attemptNo: number): AttemptRow {
    const id = generateEventId()
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO team_run_stage_attempts (
        id, run_id, stage_id, attempt_no, agent_instance_id, status, result_summary, result_artifact_id,
        error_code, error_message, retryable, started_at, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, 'created', '', NULL, NULL, NULL, 0, NULL, NULL, ?, ?)
    `).run(id, runId, stageId, attemptNo, now, now)
    return this.db.prepare('SELECT * FROM team_run_stage_attempts WHERE id = ?').get(id) as AttemptRow
  }

  private allocateExecutionBindings(
    run: RunRow,
    stage: StageRow,
    compiledPlan: CompiledRunPlanV1 | null,
  ): ExecutionBindings {
    const attempt = this.getPendingAttempt(stage.id) || this.createAttempt(run.id, stage.id, this.getNextAttemptNo(stage.id))
    const compiledStage = compiledPlan?.stages.find((item) => item.stageId === stage.id)
    const compiledRole = compiledPlan?.roles.find((item) => item.roleId === stage.role_id)
    const agentBinding = this.buildAgentExecutionBinding(compiledRole, compiledStage, stage)
    const agentInstanceId = generateEventId()
    const taskMemoryId = this.ensureMemorySpace(run.id, 'task', run.task_id || run.id, this.buildTaskMemoryContent(run))
    const plannerMemoryId = this.ensureMemorySpace(run.id, 'planner', run.id, this.buildPlannerMemoryContent(run))
    const agentMemoryId = this.ensureMemorySpace(
      run.id,
      'agent_instance',
      agentInstanceId,
      this.buildAgentMemorySeed(stage, attempt.attempt_no),
      stage.id,
    )
    const now = Date.now()

    this.db.prepare(`
      INSERT INTO team_run_agent_instances (
        id, run_id, stage_id, agent_definition_id, memory_space_id, status, created_at, released_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      agentInstanceId,
      run.id,
      stage.id,
      agentBinding.agentDefinitionId,
      agentMemoryId,
      'allocated',
      now,
    )

    this.db.prepare(`
      UPDATE team_run_stage_attempts
      SET agent_instance_id = ?, status = ?, started_at = ?, updated_at = ?
      WHERE id = ?
    `).run(agentInstanceId, 'running', now, now, attempt.id)

    this.db.prepare(`
      UPDATE team_run_agent_instances
      SET status = ?
      WHERE id = ?
    `).run('running', agentInstanceId)

    return {
      attemptId: attempt.id,
      attemptNo: attempt.attempt_no,
      agentInstanceId,
      taskMemoryId,
      plannerMemoryId,
      agentMemoryId,
    }
  }

  private finalizeAttempt(
    attemptId: string,
    status: AttemptStatus,
    payload: {
      resultSummary?: string
      resultArtifactId?: string | null
      errorCode?: string | null
      errorMessage?: string | null
      retryable?: boolean
    } = {},
  ): void {
    const completedAt = Date.now()
    this.db.prepare(`
      UPDATE team_run_stage_attempts
      SET status = ?, result_summary = ?, result_artifact_id = ?, error_code = ?, error_message = ?,
          retryable = ?, completed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      status,
      (payload.resultSummary || '').slice(0, 4000),
      payload.resultArtifactId || null,
      payload.errorCode || null,
      payload.errorMessage || null,
      payload.retryable ? 1 : 0,
      completedAt,
      completedAt,
      attemptId,
    )
  }

  private finalizeAgentInstance(agentInstanceId: string, status: AgentInstanceStatus): void {
    this.db.prepare(`
      UPDATE team_run_agent_instances
      SET status = ?, released_at = ?
      WHERE id = ?
    `).run(status, Date.now(), agentInstanceId)
  }

  private syncRunSummary(runId: string): void {
    const stages = this.getStages(runId)
    this.db.prepare(`
      UPDATE team_runs
      SET summary = ?, projection_version = projection_version + 1
      WHERE id = ?
    `).run(buildRunSummary(stages), runId)
  }

  private buildLegacyAgentSystemPrompt(role: CompiledRoleV1 | undefined, stage: CompiledStageV1 | undefined): string {
    return [
      `You are ${role?.name || 'Team Worker'}.`,
      `Role responsibility: ${role?.responsibility || 'Complete the assigned stage within the team run contract.'}`,
      `Agent type: ${role?.agentType || stage?.ownerAgentType || 'worker.default'}`,
      'Work only within the assigned stage contract.',
      'Use dependency summaries and workspace context to produce a concise, publishable result.',
      'Do not invent upstream outputs or claim work that is not grounded in available inputs.',
    ].join('\n')
  }

  private buildLegacyAllowedTools(agentType: string): string[] {
    if (agentType.startsWith('orchestrator')) {
      return ['workspace.read', 'workspace.write', 'shell.exec', 'plan.update']
    }
    if (agentType.startsWith('lead')) {
      return ['workspace.read', 'workspace.write', 'shell.exec']
    }
    return ['workspace.read', 'workspace.write', 'shell.exec']
  }

  private buildAgentExecutionBinding(
    compiledRole: CompiledRoleV1 | undefined,
    compiledStage: CompiledStageV1 | undefined,
    stage: StageRow,
  ): AgentExecutionBindingV1 {
    const agentType = compiledRole?.agentType || compiledStage?.ownerAgentType || stage.owner_agent_type || 'worker.default'

    return {
      agentDefinitionId: compiledRole?.agentDefinitionId
        || compiledStage?.ownerAgentDefinitionId
        || stage.agent_definition_id
        || `${agentType}:${stage.role_id}`,
      agentType,
      roleName: compiledRole?.name || stage.role_id,
      systemPrompt: compiledRole?.systemPrompt || this.buildLegacyAgentSystemPrompt(compiledRole, compiledStage),
      allowedTools: compiledRole?.allowedTools?.length
        ? [...compiledRole.allowedTools]
        : this.buildLegacyAllowedTools(agentType),
      capabilityTags: compiledRole?.capabilityTags?.length ? [...compiledRole.capabilityTags] : [],
      memoryPolicy: compiledRole?.memoryPolicy || 'ephemeral-stage',
      outputSchema: compiledRole?.outputSchema || 'stage-execution-result/v1',
      concurrencyLimit: compiledRole?.concurrencyLimit || 1,
      ...(compiledRole?.presetId ? { presetId: compiledRole.presetId } : {}),
    }
  }

  private buildDependencyRefs(
    runId: string,
    compiledPlan: CompiledRunPlanV1 | null,
    dependencyIds: string[],
  ): DependencyResultRefV1[] {
    const stageById = new Map(this.getStages(runId).map((item) => [item.id, item]))
    const compiledStageById = new Map(compiledPlan?.stages.map((item) => [item.stageId, item]) || [])

    return dependencyIds.map((dependencyId) => {
      const stage = stageById.get(dependencyId)
      const compiledStage = compiledStageById.get(dependencyId)
      return {
        stageId: dependencyId,
        title: stage?.name || compiledStage?.title || dependencyId,
        summary: truncateSummary(stage?.latest_result || ''),
        artifactRefs: this.getStageArtifactRefs(dependencyId, stage?.latest_result_ref || undefined),
      }
    })
  }

  private getStageArtifactRefs(stageId: string, latestResultRef?: string): string[] {
    const rows = this.db.prepare(`
      SELECT id
      FROM team_run_artifacts
      WHERE stage_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(stageId) as ArtifactRow[]

    return Array.from(new Set([
      ...rows.map((row) => row.id),
      ...(latestResultRef ? [latestResultRef] : []),
    ]))
  }

  private mapStageArtifactType(kind: StageExecutionPayloadV1['stage']['outputContract']['artifactKinds'][number]): 'file' | 'log' | 'metadata' {
    if (kind === 'file' || kind === 'log' || kind === 'metadata') {
      return kind
    }
    return 'metadata'
  }

  private async persistExecutionArtifacts(
    run: RunRow,
    stage: StageRow,
    result: StageExecutionResultV1,
    artifactOutputDir: string,
  ): Promise<{ detailArtifactId?: string | null }> {
    const persistedArtifacts = new Map<string, string>()
    const normalizedOutputDir = path.resolve(artifactOutputDir)

    for (const artifact of result.artifacts) {
      if (!artifact.relativePath) {
        continue
      }

      const absolutePath = path.resolve(normalizedOutputDir, artifact.relativePath)
      if (!absolutePath.startsWith(normalizedOutputDir)) {
        throw new Error(`Artifact path escapes the output directory: ${artifact.relativePath}`)
      }
      if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
        throw new Error(`Artifact file not found: ${artifact.relativePath}`)
      }

      const artifactId = await this.stateManager.saveArtifact({
        runId: run.id,
        stageId: stage.id,
        type: this.mapStageArtifactType(artifact.kind),
        title: artifact.title,
        sourcePath: artifact.relativePath,
        content: fs.readFileSync(absolutePath),
        contentType: artifact.contentType || 'text/plain',
      })
      artifact.artifactId = artifactId
      persistedArtifacts.set(artifact.relativePath, artifactId)
    }

    const detailArtifactId = result.detailArtifactPath
      ? persistedArtifacts.get(result.detailArtifactPath) || null
      : null

    return { detailArtifactId }
  }

  private async persistFailureDiagnosticsArtifact(
    run: RunRow,
    stage: StageRow,
    result: StageExecutionResultV1,
  ): Promise<string | null> {
    if (!result.diagnostics) {
      return null
    }

    return this.stateManager.saveArtifact({
      runId: run.id,
      stageId: stage.id,
      type: 'log',
      title: 'Failure diagnostics',
      sourcePath: 'failure-diagnostics.json',
      content: JSON.stringify({
        runId: run.id,
        stageId: stage.id,
        attempt: result.attempt,
        outcome: result.outcome,
        error: result.error || null,
        diagnostics: result.diagnostics,
        recordedAt: new Date().toISOString(),
      }, null, 2),
      contentType: 'application/json',
    })
  }

  private async persistFinalSummaryArtifact(
    run: RunRow,
    stages: StageRow[],
    finalSummary: string,
  ): Promise<string | null> {
    if (!finalSummary.trim()) {
      return null
    }

    const targetStage = [...stages].reverse().find((stage) => stage.status === 'done') || stages[stages.length - 1]
    if (!targetStage) {
      return null
    }

    const existing = this.db.prepare(`
      SELECT id
      FROM team_run_artifacts
      WHERE run_id = ? AND source_path = 'final-summary.md'
      LIMIT 1
    `).get(run.id) as { id: string } | undefined

    const content = Buffer.from(finalSummary, 'utf8')
    if (existing) {
      await this.db.prepare(`
        UPDATE team_run_artifacts
        SET stage_id = ?, type = ?, title = ?, content = ?, content_type = ?, size = ?, created_at = ?
        WHERE id = ?
      `).run(
        targetStage.id,
        'output',
        'Final summary',
        content,
        'text/markdown',
        content.length,
        Date.now(),
        existing.id,
      )
      return existing.id
    }

    return this.stateManager.saveArtifact({
      runId: run.id,
      stageId: targetStage.id,
      type: 'output',
      title: 'Final summary',
      sourcePath: 'final-summary.md',
      content: finalSummary,
      contentType: 'text/markdown',
    })
  }

  private buildFinalSummaryPayload(
    run: RunRow,
    stages: StageRow[],
    runSummary: string,
  ): FinalSummaryPayloadV1 {
    const taskContext = this.buildTaskContext(run)

    return {
      contractVersion: 'final-summary-payload/v1',
      taskId: run.task_id || run.plan_id,
      sessionId: run.session_id || '',
      runId: run.id,
      userGoal: taskContext.userGoal,
      expectedOutcome: taskContext.expectedOutcome,
      stageResults: stages
        .filter((stage) => ['done', 'failed', 'blocked', 'cancelled'].includes(stage.status))
        .map((stage) => ({
          stageId: stage.id,
          title: stage.name,
          status: stage.status as FinalSummaryPayloadV1['stageResults'][number]['status'],
          summary: (stage.latest_result || stage.error || '').trim(),
          artifactRefs: this.getStageArtifactRefs(stage.id, stage.latest_result_ref || undefined),
        })),
      runSummary,
    }
  }

  private selectRunnableBatch(
    stages: StageRow[],
    compiledPlan: CompiledRunPlanV1 | null,
    maxParallelWorkers: number,
  ): StageRow[] {
    const activeByAgentDefinitionId = new Map<string, number>()

    for (const stage of stages.filter((item) => item.status === 'running')) {
      const compiledStage = compiledPlan?.stages.find((item) => item.stageId === stage.id)
      const compiledRole = compiledPlan?.roles.find((item) => item.roleId === stage.role_id)
      const binding = this.buildAgentExecutionBinding(compiledRole, compiledStage, stage)
      activeByAgentDefinitionId.set(
        binding.agentDefinitionId,
        (activeByAgentDefinitionId.get(binding.agentDefinitionId) || 0) + 1,
      )
    }

    const batch: StageRow[] = []
    for (const stage of stages.filter((item) => item.status === 'ready')) {
      const compiledStage = compiledPlan?.stages.find((item) => item.stageId === stage.id)
      const compiledRole = compiledPlan?.roles.find((item) => item.roleId === stage.role_id)
      const binding = this.buildAgentExecutionBinding(compiledRole, compiledStage, stage)
      const currentActive = activeByAgentDefinitionId.get(binding.agentDefinitionId) || 0
      const concurrencyLimit = Math.max(1, binding.concurrencyLimit || 1)

      if (currentActive >= concurrencyLimit) {
        continue
      }

      batch.push(stage)
      activeByAgentDefinitionId.set(binding.agentDefinitionId, currentActive + 1)

      if (batch.length >= maxParallelWorkers) {
        break
      }
    }

    return batch
  }

  private buildStageExecutionPayload(
    run: RunRow,
    stage: StageRow,
    bindings: ExecutionBindings,
    workspace: { stageWorkDir: string; sharedReadDir: string; outputDir: string },
    compiledPlan: CompiledRunPlanV1 | null,
  ): StageExecutionPayloadV1 {
    const compiledStage = compiledPlan?.stages.find((item) => item.stageId === stage.id)
    const compiledRole = compiledPlan?.roles.find((item) => item.roleId === stage.role_id)
    const runWorkspace = path.dirname(path.dirname(workspace.stageWorkDir))
    const agent = this.buildAgentExecutionBinding(compiledRole, compiledStage, stage)

    return {
      contractVersion: 'stage-execution-payload/v1',
      taskId: run.task_id || run.plan_id,
      sessionId: run.session_id || '',
      runId: run.id,
      stageId: stage.id,
      attempt: bindings.attemptNo,
      workspace: {
        sessionWorkspace: compiledPlan?.workspaceRoot || runWorkspace,
        runWorkspace,
        stageWorkspace: workspace.stageWorkDir,
        sharedReadDir: workspace.sharedReadDir,
        artifactOutputDir: workspace.outputDir,
      },
      agent,
      taskContext: this.buildTaskContext(run),
      stage: {
        title: compiledStage?.title || stage.name,
        description: compiledStage?.description || stage.description || stage.task,
        acceptanceCriteria: compiledStage?.acceptanceCriteria || [`Complete stage: ${stage.name}`],
        inputContract: compiledStage?.inputContract || {
          requiredDependencyOutputs: [],
          taskContext: {
            includeUserGoal: true,
            includeExpectedOutcome: true,
            includeRunSummary: true,
          },
        },
        outputContract: compiledStage?.outputContract || {
          primaryFormat: 'markdown',
          mustProduceSummary: true,
          mayProduceArtifacts: true,
          artifactKinds: ['file', 'log', 'metadata', 'report'],
        },
      },
      dependencies: this.buildDependencyRefs(run.id, compiledPlan, parseDependencies(stage.dependencies)),
      memoryRefs: {
        taskMemoryId: bindings.taskMemoryId,
        plannerMemoryId: bindings.plannerMemoryId,
        agentMemoryId: bindings.agentMemoryId,
      },
    }
  }

  async startRun(runId: string): Promise<void> {
    await this.markRunStarted(runId)
    void this.processRun(runId).catch((error) => {
      console.error('Run execution failed:', error)
    })
  }

  async processRun(runId: string): Promise<void> {
    await this.markRunStarted(runId)

    while (true) {
      let run = this.getRun(runId)
      if (!run) return

      let stages = this.getStages(runId)

      if (run.status === 'paused') {
        return
      }

      if (run.status === 'cancelled') {
        return
      }

      if (run.status === 'cancelling' || run.cancel_requested_at) {
        if (run.status !== 'cancelling') {
          await this.transitionRunToCancelling(runId)
          run = this.getRun(runId)
          if (!run) return
        }

        if (stages.some((stage) => stage.status === 'running')) {
          return
        }

        await this.cancelPendingStages(runId)
        await this.finalizeRun(runId, 'cancelled')
        return
      }

      if (run.status === 'summarizing') {
        await this.summarizeRun(runId)
        return
      }

      await this.promoteReadyStages(stages)
      stages = this.getStages(runId)

      run = this.getRun(runId)
      if (!run) return

      if (run.pause_requested_at) {
        if (stages.some((stage) => stage.status === 'running')) {
          return
        }
        await this.transitionRunToPaused(runId)
        return
      }

      const runnable = stages.filter((stage) => stage.status === 'ready')
      if (runnable.length === 0) {
        const hasFailed = stages.some((stage) => stage.status === 'failed')
        await this.blockStagesFromFailedDependencies(stages)
        stages = this.getStages(runId)

        if (stages.every((stage) => stage.status === 'done')) {
          await this.summarizeRun(runId)
          return
        }
        if (hasFailed || stages.some((stage) => stage.status === 'blocked')) {
          await this.finalizeRun(runId, 'failed')
          return
        }
        return
      }

      const compiledPlan = parseCompiledRunPlan(run.compiled_plan_json)
      const budget = compiledPlan?.budget || {
        maxParallelWorkers: 3,
        maxRetriesPerTask: 1,
        maxRunMinutes: 120,
      }
      const batch = this.selectRunnableBatch(
        stages,
        compiledPlan,
        Math.max(1, budget.maxParallelWorkers || 1),
      )
      if (batch.length === 0) {
        return
      }

      await Promise.all(
        batch.map((stage) => this.concurrencyController.execute(async () => {
          await this.executeStage(runId, stage, budget.maxRunMinutes)
        })),
      )
    }
  }

  private async markRunStarted(runId: string): Promise<void> {
    const run = this.getRun(runId)
    if (!run) {
      throw new Error(`Run not found: ${runId}`)
    }

    if (run.status === 'running') {
      return
    }

    if (isTerminalRunStatus(run.status) || run.status === 'paused' || run.status === 'cancelling' || run.status === 'summarizing') {
      return
    }

    await this.db.prepare(`
      UPDATE team_runs
      SET status = ?, started_at = COALESCE(started_at, ?), projection_version = projection_version + 1
      WHERE id = ?
    `).run('running', Date.now(), runId)
    this.recordEvent(runId, 'run.started')
    publishTeamRunChatUpdate({ db: this.db, runId, eventType: 'run.started' })

    await this.db.prepare(`
      UPDATE team_run_stages
      SET status = CASE WHEN status = 'running' THEN 'ready' ELSE status END,
          updated_at = ?
      WHERE run_id = ? AND status = 'running'
    `).run(Date.now(), runId)
  }

  private async executeStage(runId: string, stage: StageRow, maxRunMinutes: number): Promise<void> {
    const run = this.getRun(runId)
    if (!run) {
      throw new Error(`Run not found: ${runId}`)
    }

    const compiledPlan = parseCompiledRunPlan(run.compiled_plan_json)
    const bindings = this.allocateExecutionBindings(run, stage, compiledPlan)
    const workspace = this.workspaceManager.prepareStageWorkspace(runId, stage.id)
    const startedAt = Date.now()
    await this.db.prepare(`
      UPDATE team_run_stages
      SET status = ?, started_at = COALESCE(started_at, ?), updated_at = ?, error = NULL, last_error = NULL, last_attempt_id = ?
      WHERE id = ?
    `).run('running', startedAt, startedAt, bindings.attemptId, stage.id)
    this.recordEvent(runId, 'stage.started', {
      attemptId: bindings.attemptId,
      attemptNo: bindings.attemptNo,
      agentInstanceId: bindings.agentInstanceId,
    }, stage.id)
    publishTeamRunChatUpdate({ db: this.db, runId, eventType: 'stage.started', stageId: stage.id })

    const worker = this.workerFactory()
    const payload = this.buildStageExecutionPayload(run, stage, bindings, workspace, compiledPlan)
    const result = await worker.execute(payload)
    const { detailArtifactId } = await this.persistExecutionArtifacts(run, stage, result, workspace.outputDir)
    const failureDiagnosticsArtifactId = result.outcome !== 'done'
      ? await this.persistFailureDiagnosticsArtifact(run, stage, result)
      : null

    const currentRun = this.getRun(runId)
    const cancelRequested = Boolean(currentRun?.cancel_requested_at || currentRun?.status === 'cancelling' || currentRun?.status === 'cancelled')
    const completedAt = Date.now()
    const memoryAppends = result.memoryAppend || []
    for (const item of memoryAppends) {
      if (item.scope === 'agent') {
        this.appendMemoryContent(bindings.agentMemoryId, item.content)
      }
    }

    if (result.outcome === 'done') {
      const stageResultRef = await this.stateManager.updateStageResult(stage.id, result.summary)
      if (detailArtifactId) {
        await this.stateManager.attachStageResultRef(stage.id, detailArtifactId)
      }
      await this.db.prepare(`
        UPDATE team_run_stages
        SET status = ?, completed_at = ?, updated_at = ?, error = NULL, last_error = NULL
        WHERE id = ?
      `).run(cancelRequested ? 'cancelled' : 'done', completedAt, completedAt, stage.id)
      this.finalizeAttempt(bindings.attemptId, cancelRequested ? 'cancelled' : 'done', {
        resultSummary: result.summary,
        resultArtifactId: detailArtifactId || result.detailArtifactRef || stageResultRef.artifactId || null,
      })
      this.finalizeAgentInstance(bindings.agentInstanceId, cancelRequested ? 'released' : 'completed')
      this.appendMemoryContent(bindings.plannerMemoryId, `Stage ${stage.name} attempt ${bindings.attemptNo} [${cancelRequested ? 'cancelled' : 'done'}]\n${result.summary.trim()}`)
      this.recordEvent(runId, cancelRequested ? 'stage.cancelled' : 'stage.completed', {
        attemptId: bindings.attemptId,
        attemptNo: bindings.attemptNo,
      }, stage.id)
      if (!cancelRequested) {
        publishTeamRunChatUpdate({ db: this.db, runId, eventType: 'stage.completed', stageId: stage.id })
      }
      this.syncRunSummary(runId)
      return
    }

    const errorMessage = selectStageErrorMessage(result)
    await this.stateManager.updateStageError(stage.id, errorMessage)
    await this.db.prepare(`
      UPDATE team_run_stages
      SET status = ?, completed_at = ?, updated_at = ?, error = ?, last_error = ?
      WHERE id = ?
    `).run(
      cancelRequested ? 'cancelled' : (result.outcome === 'blocked' ? 'blocked' : 'failed'),
      completedAt,
      completedAt,
      errorMessage,
      errorMessage,
      stage.id,
    )
    if (detailArtifactId || failureDiagnosticsArtifactId) {
      await this.stateManager.attachStageResultRef(stage.id, detailArtifactId || failureDiagnosticsArtifactId!)
    }
    this.finalizeAttempt(bindings.attemptId, cancelRequested ? 'cancelled' : 'failed', {
      resultSummary: result.summary,
      resultArtifactId: detailArtifactId || result.detailArtifactRef || failureDiagnosticsArtifactId || null,
      errorCode: result.error?.code || (result.outcome === 'blocked' ? 'blocked' : 'execution_failed'),
      errorMessage: buildAttemptErrorMessage(result, errorMessage),
      retryable: !cancelRequested && Boolean(result.error?.retryable),
    })
    this.finalizeAgentInstance(bindings.agentInstanceId, cancelRequested ? 'released' : (result.outcome === 'blocked' ? 'failed' : 'failed'))
    this.appendMemoryContent(bindings.plannerMemoryId, `Stage ${stage.name} attempt ${bindings.attemptNo} [${cancelRequested ? 'cancelled' : result.outcome}]\n${errorMessage.trim()}`)
    this.recordEvent(runId, cancelRequested ? 'stage.cancelled' : (result.outcome === 'blocked' ? 'stage.blocked' : 'stage.failed'), {
        attemptId: bindings.attemptId,
        attemptNo: bindings.attemptNo,
        ...(failureDiagnosticsArtifactId ? { diagnosticsArtifactId: failureDiagnosticsArtifactId } : {}),
      error: errorMessage,
    }, stage.id)
    if (!cancelRequested) {
      publishTeamRunChatUpdate({
        db: this.db,
        runId,
        eventType: result.outcome === 'blocked' ? 'stage.blocked' : 'stage.failed',
        stageId: stage.id,
        errorMessage,
      })
    }
    this.syncRunSummary(runId)
  }

  private async transitionRunToCancelling(runId: string): Promise<void> {
    const run = this.getRun(runId)
    if (!run || run.status === 'cancelled' || run.status === 'cancelling') {
      return
    }

    await this.db.prepare(`
      UPDATE team_runs
      SET status = ?, pause_requested_at = NULL, projection_version = projection_version + 1
      WHERE id = ?
    `).run('cancelling', runId)
  }

  private async transitionRunToPaused(runId: string): Promise<void> {
    const run = this.getRun(runId)
    if (!run || run.status === 'paused' || run.cancel_requested_at || run.status === 'cancelling') {
      return
    }

    await this.db.prepare(`
      UPDATE team_runs
      SET status = ?, projection_version = projection_version + 1
      WHERE id = ?
    `).run('paused', runId)
    this.recordEvent(runId, 'run.paused')
  }

  private async summarizeRun(runId: string): Promise<void> {
    const run = this.getRun(runId)
    if (!run || isTerminalRunStatus(run.status) || run.status === 'cancelled' || run.cancel_requested_at) {
      return
    }

    if (run.status !== 'summarizing') {
      await this.db.prepare(`
        UPDATE team_runs
        SET status = ?, projection_version = projection_version + 1
        WHERE id = ?
      `).run('summarizing', runId)
    }

    try {
      await this.finalizeRun(runId, 'done')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate final summary'
      await this.db.prepare(`
        UPDATE team_runs
        SET status = ?, error = ?, completed_at = ?, projection_version = projection_version + 1
        WHERE id = ?
      `).run('failed', message, Date.now(), runId)
    }
  }

  private async promoteReadyStages(stages: StageRow[]): Promise<void> {
    const doneSet = new Set(stages.filter((stage) => stage.status === 'done').map((stage) => stage.id))
    for (const stage of stages) {
      if (!['pending', 'waiting', 'blocked'].includes(stage.status)) continue
      const dependencies = parseDependencies(stage.dependencies)
      if (dependencies.every((dependencyId) => doneSet.has(dependencyId))) {
        if (stage.status === 'blocked') {
          await this.db.prepare(`
            UPDATE team_run_stages
            SET status = ?, error = NULL, last_error = NULL, completed_at = NULL, updated_at = ?
            WHERE id = ?
          `).run('ready', Date.now(), stage.id)
        } else {
          await this.stateManager.updateStageStatus(stage.id, 'ready')
        }
      }
    }
  }

  private async blockStagesFromFailedDependencies(stages: StageRow[]): Promise<void> {
    const blockedIds = new Set(
      stages
        .filter((stage) => ['failed', 'blocked', 'cancelled'].includes(stage.status))
        .map((stage) => stage.id),
    )

    let changed = true
    while (changed) {
      changed = false
      const currentStages = this.getStages(stages[0]?.run_id || '')
      for (const stage of currentStages) {
        if (!['pending', 'ready', 'waiting'].includes(stage.status)) continue
        const dependencies = parseDependencies(stage.dependencies)
        if (dependencies.some((dependencyId) => blockedIds.has(dependencyId))) {
          await this.db.prepare(`
            UPDATE team_run_stages
            SET status = ?, error = ?, last_error = ?, completed_at = ?, updated_at = ?
            WHERE id = ?
          `).run('blocked', 'Blocked by failed dependency', 'Blocked by failed dependency', Date.now(), Date.now(), stage.id)
          blockedIds.add(stage.id)
          changed = true
        }
      }
    }
  }

  private async cancelPendingStages(runId: string): Promise<void> {
    await this.db.prepare(`
      UPDATE team_run_stages
      SET status = CASE
            WHEN status IN ('done', 'failed', 'cancelled') THEN status
            ELSE 'cancelled'
          END,
          completed_at = CASE
            WHEN status IN ('done', 'failed', 'cancelled') THEN completed_at
            ELSE ?
          END,
          updated_at = ?
      WHERE run_id = ?
    `).run(Date.now(), Date.now(), runId)

    await this.db.prepare(`
      UPDATE team_run_stage_attempts
      SET status = CASE
            WHEN status IN ('done', 'failed', 'cancelled') THEN status
            ELSE 'cancelled'
          END,
          completed_at = CASE
            WHEN status IN ('done', 'failed', 'cancelled') THEN completed_at
            ELSE ?
          END,
          updated_at = ?
      WHERE run_id = ?
    `).run(Date.now(), Date.now(), runId)

    await this.db.prepare(`
      UPDATE team_run_agent_instances
      SET status = CASE
            WHEN status IN ('completed', 'failed', 'released') THEN status
            ELSE 'released'
          END,
          released_at = COALESCE(released_at, ?)
      WHERE run_id = ?
    `).run(Date.now(), runId)
  }

  private async finalizeRun(runId: string, status: RunStatus): Promise<void> {
    const run = this.getRun(runId)
    if (!run) {
      return
    }
    if (isTerminalRunStatus(run.status) && run.status === status && run.completed_at) {
      return
    }

    const stages = this.getStages(runId)
    const summary = run.summary.trim() || buildRunSummary(stages)
    const finalSummaryResult = status === 'done' && !run.final_summary.trim()
      ? createFinalSummaryResult(this.buildFinalSummaryPayload(run, stages, summary))
      : null
    const finalSummary = status === 'done'
      ? (run.final_summary.trim() || finalSummaryResult?.finalSummary || '')
      : ''
    const errorStage = stages.find((stage) => stage.status === 'failed' || stage.status === 'blocked')
    const completedAt = Date.now()
    const finalSummaryArtifactId = status === 'done'
      ? await this.persistFinalSummaryArtifact(run, stages, finalSummary)
      : null

    await this.db.prepare(`
      UPDATE team_runs
      SET status = ?, summary = ?, final_summary = ?, error = ?, completed_at = ?, projection_version = projection_version + 1
      WHERE id = ?
    `).run(
      status,
      summary,
      finalSummary,
      status === 'failed' ? (errorStage?.error || run.error || 'Run failed') : null,
      completedAt,
      runId,
    )

    if (run?.task_id) {
      this.syncTaskProjection(run, status, finalSummary)
    }

    if (status === 'done' && finalSummary) {
      this.recordEvent(runId, 'summary.generated', {
        finalSummaryLength: finalSummary.length,
        keyOutputCount: finalSummaryResult?.keyOutputs.length || 0,
        finalSummaryArtifactId,
      })
      publishTeamRunChatUpdate({ db: this.db, runId, eventType: 'summary.generated' })
    }
    if (status === 'cancelled') {
      this.recordEvent(runId, 'run.cancelled')
      publishTeamRunChatUpdate({ db: this.db, runId, eventType: 'run.cancelled' })
    }
  }

  private getRun(runId: string): RunRow | undefined {
    return this.db.prepare('SELECT * FROM team_runs WHERE id = ?').get(runId) as RunRow | undefined
  }

  private getStages(runId: string): StageRow[] {
    return this.db.prepare('SELECT * FROM team_run_stages WHERE run_id = ? ORDER BY created_at ASC, id ASC').all(runId) as StageRow[]
  }

  async getStatus(runId: string): Promise<TeamRunStatus> {
    const run = this.getRun(runId)
    const stages = this.getStages(runId)
    if (!run) {
      throw new Error(`Run not found: ${runId}`)
    }

    const stageStatuses: StageStatus[] = stages.map((stage) => ({
      id: stage.id,
      roleId: stage.role_id,
      task: stage.task,
      status: stage.status,
      dependsOn: parseDependencies(stage.dependencies),
      output: stage.latest_result || undefined,
      error: stage.error || undefined,
      retryCount: stage.retry_count,
      startedAt: stage.started_at || undefined,
      completedAt: stage.completed_at || undefined,
    }))

    const progress: RunProgress = {
      total: stages.length,
      completed: stages.filter((stage) => stage.status === 'done').length,
      failed: stages.filter((stage) => stage.status === 'failed').length,
      running: stages.filter((stage) => stage.status === 'running').length,
      blocked: stages.filter((stage) => stage.status === 'blocked').length,
    }

    return {
      runId: run.id,
      planId: run.plan_id,
      status: run.status === 'failed' && progress.failed === 0 && progress.blocked > 0 ? 'blocked' : run.status,
      progress,
      stages: stageStatuses,
      startedAt: run.started_at || undefined,
      completedAt: run.completed_at || undefined,
      error: run.error || undefined,
    }
  }

  async retryStage(runId: string, stageId: string): Promise<void> {
    const run = this.getRun(runId)
    if (!run) {
      throw new Error(`Run not found: ${runId}`)
    }
    if (['cancelled', 'done', 'cancelling', 'summarizing'].includes(run.status)) {
      throw new Error(`Run does not allow retry in status: ${run.status}`)
    }

    const stage = this.db.prepare(`
      SELECT *
      FROM team_run_stages
      WHERE id = ? AND run_id = ?
    `).get(stageId, runId) as StageRow | undefined
    if (!stage) {
      throw new Error(`Stage not found: ${stageId}`)
    }
    if (stage.status !== 'failed') {
      throw new Error(`Only failed stages can be retried: ${stage.status}`)
    }

    const compiledPlan = parseCompiledRunPlan(run.compiled_plan_json)
    const maxRetries = compiledPlan?.budget.maxRetriesPerTask ?? 1
    if (stage.retry_count >= maxRetries) {
      throw new Error(`Retry limit reached for stage: ${stageId}`)
    }

    const attempt = this.createAttempt(runId, stageId, this.getNextAttemptNo(stageId))
    const now = Date.now()
    await this.db.prepare(`
      UPDATE team_run_stages
      SET status = ?, error = NULL, last_error = NULL, latest_result = NULL, latest_result_ref = NULL,
          completed_at = NULL, updated_at = ?, retry_count = retry_count + 1, last_attempt_id = ?
      WHERE id = ?
    `).run('ready', now, attempt.id, stageId)

    if (run.status === 'failed' || run.status === 'ready' || run.status === 'pending') {
      await this.db.prepare(`
        UPDATE team_runs
        SET status = ?, error = NULL, completed_at = NULL, projection_version = projection_version + 1
        WHERE id = ?
      `).run('running', runId)
    } else {
      this.bumpRunProjectionVersion(runId)
    }

    this.recordEvent(runId, 'stage.retry_requested', {
      attemptId: attempt.id,
      attemptNo: attempt.attempt_no,
    }, stageId)
    this.syncRunSummary(runId)
  }

  async pauseRun(runId: string): Promise<void> {
    const run = this.getRun(runId)
    if (!run || isTerminalRunStatus(run.status) || run.status === 'paused' || run.status === 'cancelling' || run.status === 'summarizing') {
      return
    }

    const requestTime = run.pause_requested_at || Date.now()
    if (!run.pause_requested_at) {
      await this.db.prepare(`
        UPDATE team_runs
        SET pause_requested_at = ?, projection_version = projection_version + 1
        WHERE id = ?
      `).run(requestTime, runId)
      this.recordEvent(runId, 'run.pause_requested')
    }

    const hasRunningStages = this.getStages(runId).some((stage) => stage.status === 'running')
    if (!hasRunningStages) {
      await this.transitionRunToPaused(runId)
    }
  }

  async cancelRun(runId: string): Promise<void> {
    const run = this.getRun(runId)
    if (!run || run.status === 'cancelled' || isTerminalRunStatus(run.status)) {
      return
    }

    const requestTime = run.cancel_requested_at || Date.now()
    if (!run.cancel_requested_at) {
      await this.db.prepare(`
        UPDATE team_runs
        SET cancel_requested_at = ?, pause_requested_at = NULL, projection_version = projection_version + 1
        WHERE id = ?
      `).run(requestTime, runId)
      this.recordEvent(runId, 'run.cancel_requested')
    }

    await this.transitionRunToCancelling(runId)

    const hasRunningStages = this.getStages(runId).some((stage) => stage.status === 'running')
    if (!hasRunningStages) {
      await this.cancelPendingStages(runId)
      await this.finalizeRun(runId, 'cancelled')
    }
  }

  async resumeRun(runId: string): Promise<void> {
    const run = this.getRun(runId)
    if (!run || run.status !== 'paused') {
      return
    }

    const stages = this.getStages(runId)
    await this.promoteReadyStages(stages)

    await this.db.prepare(`
      UPDATE team_runs
      SET status = ?, pause_requested_at = NULL, projection_version = projection_version + 1
      WHERE id = ?
    `).run('running', runId)

    this.updateRuntimeMeta(runId, (current) => ({
      ...current,
      version: typeof current.version === 'number' ? current.version : 1,
      resumeCount: typeof current.resumeCount === 'number' ? current.resumeCount + 1 : 1,
    }))
  }
}
