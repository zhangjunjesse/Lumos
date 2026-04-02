import crypto from 'crypto';
import {
  createTeamRunSkeleton,
  TEAM_PLAN_TASK_KIND,
  parseAgentPresetRecord,
  parseTeamPlan,
  parseTeamPlanTaskRecord,
  parseTeamTemplateRecord,
  serializeTeamPlanTaskRecord,
} from '@/types';
import type {
  AgentPresetDirectoryItem,
  AgentPresetRecord,
  TaskItem,
  TaskStatus,
  TeamPlan,
  TeamPlanApprovalStatus,
  TeamPlanTaskRecord,
  TeamTemplateDirectoryItem,
  TeamTemplateRecord,
  TeamRun,
  TeamRunContext,
  TeamRunStage,
  TeamRunStatus,
} from '@/types';
import { compileTeamPlanToRunPlan, parseCompiledRunPlan } from '@/lib/team-run/compiler';
import { ensureTaskRunScheduled } from '@/lib/team-run/runtime-manager';
import { taskEventBus } from '@/lib/task-event-bus';
import { getDb } from './connection';
import { getSession } from './sessions';

// ==========================================
// Task Operations
// ==========================================

interface GetTasksBySessionOptions {
  kind?: typeof TEAM_PLAN_TASK_KIND;
  includeSystem?: boolean;
}

interface TemplateRow {
  id: string;
  name: string;
  type: string;
  category: string;
  content_skeleton: string;
  system_prompt: string;
  opening_message: string;
  ai_config: string;
  icon: string;
  description: string;
  usage_count: number;
  created_at: string;
  updated_at: string;
}

type TaskRow = TaskItem;

interface MainAgentSessionTeamRuntimeTaskView {
  taskId: string;
  title: string;
  userGoal: string;
  approvalStatus: TeamPlanApprovalStatus;
  runStatus: TeamRunStatus | 'not_started';
  publishedToChat: boolean;
  currentStage?: string;
  finalSummary?: string;
  latestOutput?: string;
  runId?: string;
  deliverablePaths: string[];
  updatedAt: string;
}

export interface MainAgentSessionTeamRuntimeState {
  preferredTask: MainAgentSessionTeamRuntimeTaskView | null;
  pendingTasks: MainAgentSessionTeamRuntimeTaskView[];
  additionalTasks: MainAgentSessionTeamRuntimeTaskView[];
}

interface TeamRunRow {
  id: string;
  plan_id: string;
  task_id: string | null;
  session_id: string | null;
  status: string;
  planner_version: string;
  planning_input_json: string;
  compiled_plan_json: string;
  workspace_root: string;
  summary: string;
  final_summary: string;
  pause_requested_at: number | null;
  cancel_requested_at: number | null;
  published_at: string | null;
  projection_version: number;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  error: string | null;
}

interface TeamRunStageRow {
  id: string;
  run_id: string;
  name: string;
  role_id: string;
  task: string;
  plan_task_id: string;
  description: string;
  owner_agent_type: string;
  status: string;
  dependencies: string;
  input_contract_json: string;
  output_contract_json: string;
  latest_result: string | null;
  latest_result_ref: string | null;
  error: string | null;
  last_error: string | null;
  retry_count: number;
  agent_definition_id: string | null;
  workspace_dir: string | null;
  version: number;
  last_attempt_id: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

interface StoredTeamRunMeta {
  version: 1;
  hierarchy?: TeamRun['hierarchy'];
  maxDepth?: TeamRun['maxDepth'];
  lockScope?: TeamRun['lockScope'];
  budget?: TeamRun['budget'];
  resumeCount?: number;
  summarySource?: TeamRunContext['summarySource'];
  finalSummarySource?: TeamRunContext['finalSummarySource'];
  blockedReason?: string;
  lastError?: string;
}

const MANUAL_TASK_DB_KIND = 'manual';
const TEAM_PLAN_TASK_DB_KIND = 'team_plan';
const TEAM_RUN_PLANNER_VERSION = 'compiled-run-plan/v1';
const TEAM_RUN_META_VERSION = 1;

function normalizeTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

function isPersistedTeamTask(task: TaskRow): boolean {
  return task.task_kind === TEAM_PLAN_TASK_DB_KIND;
}

function isTeamApprovalStatus(value: unknown): value is TeamPlanApprovalStatus {
  return typeof value === 'string' && ['pending', 'approved', 'rejected'].includes(value);
}

function isProjectedRunStatus(value: unknown): value is TeamRunStatus {
  return typeof value === 'string' && [
    'pending',
    'ready',
    'running',
    'waiting',
    'blocked',
    'paused',
    'cancelling',
    'cancelled',
    'summarizing',
    'done',
    'failed',
  ].includes(value);
}

function parseJsonValue<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseStoredTeamRunMeta(raw: string | null | undefined): StoredTeamRunMeta {
  const parsed = parseJsonValue<Record<string, unknown>>(raw);
  if (!parsed || typeof parsed !== 'object') {
    return { version: TEAM_RUN_META_VERSION };
  }

  const candidate = typeof parsed.runtimeMeta === 'object' && parsed.runtimeMeta !== null
    ? parsed.runtimeMeta as Record<string, unknown>
    : parsed;

  return {
    version: TEAM_RUN_META_VERSION,
    ...(Array.isArray(candidate.hierarchy) ? { hierarchy: candidate.hierarchy as TeamRun['hierarchy'] } : {}),
    ...(typeof candidate.maxDepth === 'number' ? { maxDepth: candidate.maxDepth as TeamRun['maxDepth'] } : {}),
    ...(candidate.lockScope === 'session_runtime' ? { lockScope: 'session_runtime' as const } : {}),
    ...(candidate.budget && typeof candidate.budget === 'object'
      ? { budget: candidate.budget as TeamRun['budget'] }
      : {}),
    ...(typeof candidate.resumeCount === 'number' ? { resumeCount: candidate.resumeCount } : {}),
    ...(candidate.summarySource === 'manual' ? { summarySource: 'manual' as const } : {}),
    ...(candidate.finalSummarySource === 'manual' ? { finalSummarySource: 'manual' as const } : {}),
    ...(typeof candidate.blockedReason === 'string' && candidate.blockedReason.trim()
      ? { blockedReason: candidate.blockedReason.trim() }
      : {}),
    ...(typeof candidate.lastError === 'string' && candidate.lastError.trim()
      ? { lastError: candidate.lastError.trim() }
      : {}),
  };
}

function serializeStoredTeamRunMeta(record: TeamPlanTaskRecord): string {
  const payload: StoredTeamRunMeta = {
    version: TEAM_RUN_META_VERSION,
    hierarchy: record.run.hierarchy,
    maxDepth: record.run.maxDepth,
    lockScope: record.run.lockScope,
    budget: record.run.budget,
    resumeCount: record.run.resumeCount,
    summarySource: record.run.context.summarySource === 'manual' ? 'manual' : 'auto',
    finalSummarySource: record.run.context.finalSummarySource === 'manual' ? 'manual' : 'auto',
    ...(record.run.context.blockedReason ? { blockedReason: record.run.context.blockedReason } : {}),
    ...(record.run.context.lastError ? { lastError: record.run.context.lastError } : {}),
  };

  return JSON.stringify(payload);
}

function toEpochMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function toIsoFromEpoch(value: number | null | undefined): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).toISOString()
    : null;
}

function normalizeProjectedRunStatus(status: string | null | undefined, phases: TeamRunStage[]): TeamRunStatus {
  if (status === 'failed' && !phases.some((phase) => phase.status === 'failed') && phases.some((phase) => phase.status === 'blocked')) {
    return 'blocked';
  }
  if (status && isProjectedRunStatus(status)) return status;
  return deriveRunStatus(phases);
}

function buildPendingRunSnapshot(
  task: TaskRow,
  plan: TeamPlan,
  approvalStatus: TeamPlanApprovalStatus,
): TeamRun {
  const base = createTeamRunSkeleton(plan);
  if (approvalStatus === 'approved') {
    const phases = unlockReadyPhases(base.phases);
    return {
      ...base,
      phases,
      status: deriveRunStatus(phases),
      createdAt: task.approved_at || null,
      lastUpdatedAt: task.last_action_at || task.updated_at,
    };
  }
  if (approvalStatus === 'rejected') {
    return {
      ...base,
      status: 'blocked',
      lastUpdatedAt: task.last_action_at || task.updated_at,
      context: {
        ...base.context,
        blockedReason: 'Team plan rejected by user.',
      },
    };
  }
  return {
    ...base,
    lastUpdatedAt: task.last_action_at || task.updated_at,
  };
}

function getRawTask(id: string): TaskRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
}

function getRawTasksBySession(sessionId: string): TaskRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as TaskRow[];
}

function getTeamRunRow(runId: string): TeamRunRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM team_runs WHERE id = ?').get(runId) as TeamRunRow | undefined;
}

function getTeamRunStageRows(runId: string): TeamRunStageRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM team_run_stages WHERE run_id = ? ORDER BY created_at ASC, id ASC').all(runId) as TeamRunStageRow[];
}

function buildTeamRunFromRuntime(task: TaskRow, plan: TeamPlan, runId: string): TeamRun {
  const run = getTeamRunRow(runId);
  if (!run) {
    return buildPendingRunSnapshot(task, plan, 'approved');
  }

  const meta = parseStoredTeamRunMeta(run.compiled_plan_json);
  const compiledPlan = parseCompiledRunPlan(run.compiled_plan_json);
  const base = createTeamRunSkeleton(plan);
  const stageRows = getTeamRunStageRows(runId);
  const compiledStageById = new Map(compiledPlan?.stages.map((stage) => [stage.stageId, stage]) || []);
  const compiledRoleById = new Map(compiledPlan?.roles.map((role) => [role.roleId, role]) || []);
  const stageIdToPlanTaskId = new Map(stageRows.map((stage) => {
    const compiledStage = compiledStageById.get(stage.id);
    return [stage.id, stage.plan_task_id || compiledStage?.externalTaskId || stage.id.replace(/^phase-/, '')];
  }));
  const phaseByPlanTaskId = new Map(base.phases.map((phase) => [phase.planTaskId, phase]));
  const phases: TeamRunStage[] = stageRows.length > 0
    ? stageRows.map((stage) => {
        const compiledStage = compiledStageById.get(stage.id);
        const basePhase = phaseByPlanTaskId.get(stage.plan_task_id || compiledStage?.externalTaskId || '')
          || base.phases.find((item) => item.id === stage.id);
        const dependencyIds = parseJsonValue<string[]>(stage.dependencies) || [];
        const ownerRole = compiledRoleById.get(stage.role_id);
        return {
          id: stage.id,
          planTaskId: stage.plan_task_id || compiledStage?.externalTaskId || basePhase?.planTaskId || stage.id.replace(/^phase-/, ''),
          title: stage.name || compiledStage?.title || basePhase?.title || stage.description || stage.task,
          ownerRoleId: ownerRole?.externalRoleId || compiledStage?.ownerExternalRoleId || basePhase?.ownerRoleId || stage.role_id || '',
          dependsOn: dependencyIds.map((dependencyId) => stageIdToPlanTaskId.get(dependencyId) || dependencyId.replace(/^phase-/, '')),
          expectedOutput: compiledStage?.expectedOutput || basePhase?.expectedOutput || '',
          status: isProjectedRunStatus(stage.status) ? stage.status : 'pending',
          ...(stage.latest_result?.trim() ? { latestResult: stage.latest_result.trim() } : {}),
          updatedAt: toIsoFromEpoch(stage.updated_at),
        };
      })
    : base.phases;

  const projectedRun = applyAutomaticContextBackfill({
    kind: TEAM_PLAN_TASK_KIND,
    plan,
    approvalStatus: 'approved',
    run: base,
  }, {
    status: normalizeProjectedRunStatus(run.status, phases),
    hierarchy: meta.hierarchy || base.hierarchy,
    maxDepth: meta.maxDepth || base.maxDepth,
    lockScope: meta.lockScope || base.lockScope,
    budget: meta.budget || base.budget,
    resumeCount: meta.resumeCount ?? 0,
    phases,
    pauseRequestedAt: toIsoFromEpoch(run.pause_requested_at),
    cancelRequestedAt: toIsoFromEpoch(run.cancel_requested_at),
    createdAt: toIsoFromEpoch(run.created_at),
    startedAt: toIsoFromEpoch(run.started_at),
    completedAt: toIsoFromEpoch(run.completed_at),
    lastUpdatedAt: toIsoFromEpoch(run.completed_at || run.started_at || run.created_at) || task.updated_at,
    context: {
      summary: run.summary || '',
      finalSummary: run.final_summary.trim() || (task.final_result_summary || '').trim(),
      summarySource: meta.summarySource || 'auto',
      finalSummarySource: meta.finalSummarySource || 'auto',
      ...(meta.blockedReason ? { blockedReason: meta.blockedReason } : {}),
      ...(meta.lastError || run.error ? { lastError: meta.lastError || run.error || '' } : {}),
      publishedAt: run.published_at,
    },
  });

  return projectedRun;
}

function buildTeamPlanTaskRecord(task: TaskRow): TeamPlanTaskRecord | null {
  if (isPersistedTeamTask(task)) {
    const plan = parseTeamPlan(parseJsonValue<unknown>(task.team_plan_json));
    if (!plan) return parseTeamPlanTaskRecord(task.description);

    const approvalStatus = isTeamApprovalStatus(task.team_approval_status)
      ? task.team_approval_status
      : 'pending';
    const run = approvalStatus === 'approved' && task.current_run_id
      ? buildTeamRunFromRuntime(task, plan, task.current_run_id)
      : buildPendingRunSnapshot(task, plan, approvalStatus);

    if (task.final_result_summary?.trim() && !run.context.finalSummary.trim()) {
      run.context.finalSummary = task.final_result_summary.trim();
    }

    return {
      kind: TEAM_PLAN_TASK_KIND,
      plan,
      approvalStatus,
      run,
      ...(task.source_message_id ? { sourceMessageId: task.source_message_id } : {}),
      approvedAt: task.approved_at || null,
      rejectedAt: task.rejected_at || null,
      lastActionAt: task.last_action_at || null,
    };
  }

  return parseTeamPlanTaskRecord(task.description);
}

function materializeTask(task: TaskRow): TaskItem {
  const record = buildTeamPlanTaskRecord(task);
  if (!record) return task;

  if (!isPersistedTeamTask(task)) {
    return {
      ...task,
      status: toTaskStatus(record),
      description: serializeTeamPlanTaskRecord(record),
    };
  }

  return {
    ...task,
    task_kind: TEAM_PLAN_TASK_DB_KIND,
    team_plan_json: JSON.stringify(record.plan),
    team_approval_status: record.approvalStatus,
    current_run_id: task.current_run_id || null,
    final_result_summary: record.run.context.finalSummary || task.final_result_summary || '',
    source_message_id: record.sourceMessageId || task.source_message_id || null,
    approved_at: record.approvedAt || null,
    rejected_at: record.rejectedAt || null,
    last_action_at: record.lastActionAt || null,
    status: toTaskStatus(record),
    description: serializeTeamPlanTaskRecord(record),
  };
}

function hasTemplatesTable(): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'templates'")
    .get() as { name?: string } | undefined;
  return row?.name === 'templates';
}

function parseTemplatePayload(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function listMainAgentTemplateRows(): TemplateRow[] {
  if (!hasTemplatesTable()) return [];
  const db = getDb();
  return db
    .prepare('SELECT * FROM templates WHERE type = ? ORDER BY updated_at DESC')
    .all('conversation') as TemplateRow[];
}

function isSystemTask(task: TaskItem): boolean {
  return buildTeamPlanTaskRecord(task) !== null;
}

function toTaskStatus(record: TeamPlanTaskRecord): TaskStatus {
  if (record.approvalStatus === 'rejected') {
    return 'failed';
  }
  if (record.approvalStatus === 'pending') {
    return 'pending';
  }
  if (record.run.status === 'done') {
    return 'completed';
  }
  if (record.run.status === 'failed' || record.run.status === 'blocked' || record.run.status === 'cancelled') {
    return 'failed';
  }
  return 'in_progress';
}

function formatTeamPlanTaskTitle(record: TeamPlanTaskRecord): string {
  const summary = record.plan.summary.trim() || record.plan.userGoal.trim();
  return summary.slice(0, 120);
}

function normalizeTeamPlanRecord(record: TeamPlanTaskRecord): TeamPlanTaskRecord {
  return {
    ...record,
    run: record.run || createTeamRunSkeleton(record.plan),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function canActivatePhase(phase: TeamRunStage, phases: TeamRunStage[]): boolean {
  if (phase.dependsOn.length === 0) return true;
  const phaseMap = new Map(phases.map((item) => [item.planTaskId, item]));
  return phase.dependsOn.every((dependencyId) => phaseMap.get(dependencyId)?.status === 'done');
}

function unlockReadyPhases(phases: TeamRunStage[]): TeamRunStage[] {
  return phases.map((phase) => {
    if ((phase.status === 'pending' || phase.status === 'waiting') && canActivatePhase(phase, phases)) {
      return { ...phase, status: 'ready' };
    }
    return phase;
  });
}

function deriveRunStatus(phases: TeamRunStage[]): TeamRunStatus {
  if (phases.length === 0) return 'pending';
  if (phases.every((phase) => phase.status === 'done')) return 'done';
  if (phases.some((phase) => phase.status === 'failed')) return 'failed';
  if (phases.some((phase) => phase.status === 'blocked')) return 'blocked';
  if (phases.some((phase) => phase.status === 'running')) return 'running';
  if (phases.some((phase) => phase.status === 'waiting')) return 'waiting';
  if (phases.some((phase) => phase.status === 'ready')) return 'ready';
  return 'pending';
}

function shouldMarkRunStarted(status: TeamRunStatus): boolean {
  return !['pending', 'ready'].includes(status);
}

function isTerminalTeamRunStatus(status: TeamRunStatus): boolean {
  return ['done', 'failed', 'blocked', 'cancelled'].includes(status);
}

function describePhaseWithoutResult(phase: TeamRunStage): string | null {
  switch (phase.status) {
    case 'running':
      return '阶段执行中。';
    case 'waiting':
      return '等待依赖完成。';
    case 'blocked':
      return `已阻塞，尚未产出预期结果：${phase.expectedOutput}`;
    case 'failed':
      return `执行失败，尚未产出预期结果：${phase.expectedOutput}`;
    case 'done':
      return `已完成，预期产出：${phase.expectedOutput}`;
    default:
      return null;
  }
}

function formatTeamRunStatusLabel(status: TeamRunStatus): string {
  switch (status) {
    case 'pending':
      return '待处理';
    case 'ready':
      return '就绪';
    case 'running':
      return '运行中';
    case 'waiting':
      return '等待中';
    case 'blocked':
      return '阻塞';
    case 'done':
      return '完成';
    case 'failed':
      return '失败';
    default:
      return status;
  }
}

function buildPhaseContextLine(plan: TeamPlan, phase: TeamRunStage): string | null {
  const result = phase.latestResult?.trim();
  const fallback = describePhaseWithoutResult(phase);
  if (!result && !fallback) return null;

  const owner = plan.roles.find((role) => role.id === phase.ownerRoleId);
  const ownerLabel = owner ? ` / ${owner.name}` : '';
  return `- [${formatTeamRunStatusLabel(phase.status)}] ${phase.title}${ownerLabel}: ${result || fallback}`;
}

function buildTeamContextSummary(record: TeamPlanTaskRecord, phases: TeamRunStage[]): string {
  const lines = phases
    .map((phase) => buildPhaseContextLine(record.plan, phase))
    .filter((line): line is string => Boolean(line));

  if (lines.length === 0) return '';

  return [
    `团队上下文摘要：${record.plan.summary}`,
    '',
    ...lines,
  ].join('\n').trim();
}

function buildMainAgentFinalSummary(
  record: TeamPlanTaskRecord,
  phases: TeamRunStage[],
  teamSummary: string,
): string {
  const completedCount = phases.filter((phase) => phase.status === 'done').length;
  const keyOutputs = phases
    .filter((phase) => phase.status === 'done' && phase.latestResult?.trim())
    .map((phase) => `- ${phase.title}: ${phase.latestResult!.trim()}`);

  const lines = [
    `主代理汇总：${record.plan.expectedOutcome}`,
    '',
    `已完成阶段：${completedCount}/${phases.length}。`,
  ];

  if (keyOutputs.length > 0) {
    lines.push('', '关键输出：', ...keyOutputs);
  }

  if (teamSummary.trim()) {
    lines.push('', '团队上下文快照：', teamSummary.trim());
  }

  return lines.join('\n').trim();
}

function applyAutomaticContextBackfill(record: TeamPlanTaskRecord, run: TeamRun): TeamRun {
  const nextContext: TeamRunContext = { ...run.context };
  const shouldAutoSummary = !run.context.summary.trim() || run.context.summarySource !== 'manual';

  if (shouldAutoSummary) {
    nextContext.summary = buildTeamContextSummary(record, run.phases);
    nextContext.summarySource = 'auto';
  }

  const shouldAutoFinalSummary = !run.context.finalSummary.trim() || run.context.finalSummarySource !== 'manual';
  if (run.status === 'done' && shouldAutoFinalSummary) {
    nextContext.finalSummary = buildMainAgentFinalSummary(record, run.phases, nextContext.summary);
    nextContext.finalSummarySource = 'auto';
  } else if (run.status !== 'done' && shouldAutoFinalSummary) {
    nextContext.finalSummary = '';
    nextContext.finalSummarySource = 'auto';
  }

  return {
    ...run,
    context: nextContext,
  };
}

function buildCompiledRunPayload(task: TaskRow, record: TeamPlanTaskRecord, runId: string, workspaceRoot: string): string {
  const compiledPlan = compileTeamPlanToRunPlan({
    taskId: task.id,
    sessionId: task.session_id,
    runId,
    workspaceRoot,
    plan: record.plan,
    run: record.run,
    agentPresets: listMainAgentAgentPresets(),
  });

  return JSON.stringify({
    ...compiledPlan,
    runtimeMeta: JSON.parse(serializeStoredTeamRunMeta(record)) as StoredTeamRunMeta,
  });
}

function syncTeamRunRuntime(task: TaskRow, record: TeamPlanTaskRecord): string | null {
  if (record.approvalStatus !== 'approved') {
    return null;
  }

  const db = getDb();
  const existingRunId = task.current_run_id || null;
  const runId = existingRunId || crypto.randomBytes(16).toString('hex');
  const run = getTeamRunRow(runId);
  const session = getSession(task.session_id);
  const createdAtMs = toEpochMs(record.run.createdAt)
    || run?.created_at
    || toEpochMs(task.approved_at)
    || Date.now();
  const startedAtMs = toEpochMs(record.run.startedAt) || run?.started_at || null;
  const completedAtMs = toEpochMs(record.run.completedAt) || run?.completed_at || null;
  const projectedRun = applyAutomaticContextBackfill(record, record.run);
  record.run = projectedRun;
  const summary = projectedRun.context.summary.trim();
  const finalSummary = projectedRun.context.finalSummary.trim();
  const workspaceRoot = run?.workspace_root || session?.working_directory || '';
  const compiledPlanPayload = buildCompiledRunPayload(task, record, runId, workspaceRoot);
  const compiledPlan = parseCompiledRunPlan(compiledPlanPayload);
  if (!compiledPlan) {
    throw new Error('Failed to compile team run plan');
  }
  const phaseStateByPlanTaskId = new Map(projectedRun.phases.map((phase) => [phase.planTaskId, phase]));

  if (!run) {
    db.prepare(`
      INSERT INTO team_runs (
        id, plan_id, task_id, session_id, status, planner_version, planning_input_json, compiled_plan_json,
        workspace_root, summary, final_summary, published_at, projection_version, created_at, started_at, completed_at, error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      task.id,
      task.id,
      task.session_id,
      projectedRun.status,
      TEAM_RUN_PLANNER_VERSION,
      JSON.stringify({
        summary: record.plan.summary,
        userGoal: record.plan.userGoal,
        expectedOutcome: record.plan.expectedOutcome,
        plan: record.plan,
      }),
      compiledPlanPayload,
      workspaceRoot,
      summary,
      finalSummary,
      projectedRun.context.publishedAt || null,
      1,
      createdAtMs,
      startedAtMs,
      completedAtMs,
      projectedRun.context.lastError || null,
    );
  } else {
    db.prepare(`
      UPDATE team_runs
      SET plan_id = ?, task_id = ?, session_id = ?, status = ?, planner_version = ?, planning_input_json = ?,
          compiled_plan_json = ?, workspace_root = ?, summary = ?, final_summary = ?, published_at = ?,
          projection_version = ?, created_at = ?, started_at = ?, completed_at = ?, error = ?
      WHERE id = ?
    `).run(
      task.id,
      task.id,
      task.session_id,
      projectedRun.status,
      TEAM_RUN_PLANNER_VERSION,
      JSON.stringify({
        summary: record.plan.summary,
        userGoal: record.plan.userGoal,
        expectedOutcome: record.plan.expectedOutcome,
        plan: record.plan,
      }),
      compiledPlanPayload,
      workspaceRoot,
      summary,
      finalSummary,
      projectedRun.context.publishedAt || null,
      1,
      createdAtMs,
      startedAtMs,
      completedAtMs,
      projectedRun.context.lastError || null,
      runId,
    );
  }

  const existingStages = new Map(getTeamRunStageRows(runId).map((stage) => [stage.id, stage]));
  const currentPhaseIds = new Set<string>();

  for (const compiledStage of compiledPlan.stages) {
    const phase = phaseStateByPlanTaskId.get(compiledStage.externalTaskId);
    const stageId = compiledStage.stageId;
    currentPhaseIds.add(stageId);
    const existingStage = existingStages.get(stageId);
    const updatedAtMs = toEpochMs(phase?.updatedAt)
      || existingStage?.updated_at
      || toEpochMs(projectedRun.lastUpdatedAt)
      || Date.now();
    const startedAtStageMs = existingStage?.started_at
      || (phase && (phase.status === 'running' || phase.status === 'done' || phase.status === 'failed' || phase.status === 'blocked')
        ? updatedAtMs
        : null);
    const completedAtStageMs = existingStage?.completed_at
      || (phase && (phase.status === 'done' || phase.status === 'failed' || phase.status === 'blocked') ? updatedAtMs : null);

    if (!existingStage) {
      db.prepare(`
        INSERT INTO team_run_stages (
          id, run_id, name, role_id, task, plan_task_id, description, owner_agent_type, status, dependencies,
          input_contract_json, output_contract_json, latest_result, latest_result_ref, error, last_error, retry_count,
          agent_definition_id, workspace_dir, version, last_attempt_id, started_at, completed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        stageId,
        runId,
        compiledStage.title,
        compiledStage.ownerRoleId,
        compiledStage.description,
        compiledStage.externalTaskId,
        compiledStage.description,
        compiledStage.ownerAgentType,
        phase?.status || (compiledStage.dependsOnStageIds.length > 0 ? 'pending' : 'ready'),
        JSON.stringify(compiledStage.dependsOnStageIds),
        JSON.stringify(compiledStage.inputContract),
        JSON.stringify(compiledStage.outputContract),
        phase?.latestResult || null,
        null,
        phase?.status === 'failed' ? (record.run.context.lastError || null) : null,
        phase?.status === 'failed' ? (record.run.context.lastError || null) : null,
        0,
        compiledStage.ownerAgentDefinitionId || null,
        null,
        1,
        null,
        startedAtStageMs,
        completedAtStageMs,
        createdAtMs,
        updatedAtMs,
      );
    } else {
      db.prepare(`
        UPDATE team_run_stages
        SET name = ?, role_id = ?, task = ?, plan_task_id = ?, description = ?, owner_agent_type = ?, status = ?,
            dependencies = ?, input_contract_json = ?, output_contract_json = ?, latest_result = ?, error = ?, last_error = ?, agent_definition_id = ?, started_at = ?, completed_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        compiledStage.title,
        compiledStage.ownerRoleId,
        compiledStage.description,
        compiledStage.externalTaskId,
        compiledStage.description,
        compiledStage.ownerAgentType,
        phase?.status || existingStage.status,
        JSON.stringify(compiledStage.dependsOnStageIds),
        JSON.stringify(compiledStage.inputContract),
        JSON.stringify(compiledStage.outputContract),
        phase?.latestResult || existingStage.latest_result || null,
        phase?.status === 'failed' ? (record.run.context.lastError || existingStage.error || null) : null,
        phase?.status === 'failed' ? (record.run.context.lastError || existingStage.last_error || null) : null,
        compiledStage.ownerAgentDefinitionId || existingStage.agent_definition_id || null,
        startedAtStageMs,
        completedAtStageMs,
        updatedAtMs,
        stageId,
      );
    }
  }

  const staleStageIds = Array.from(existingStages.keys()).filter((stageId) => !currentPhaseIds.has(stageId));
  for (const staleStageId of staleStageIds) {
    db.prepare('DELETE FROM team_run_stages WHERE id = ?').run(staleStageId);
  }

  return runId;
}

function persistTeamPlanRecord(taskId: string, record: TeamPlanTaskRecord): TaskItem | undefined {
  const normalized = normalizeTeamPlanRecord(record);
  const existing = getRawTask(taskId);
  if (!existing) return undefined;

  const currentRunId = syncTeamRunRuntime(existing, normalized);
  const db = getDb();
  db.prepare(`
    UPDATE tasks
    SET title = ?, status = ?, task_kind = ?, team_plan_json = ?, team_approval_status = ?, current_run_id = ?,
        final_result_summary = ?, source_message_id = ?, approved_at = ?, rejected_at = ?, last_action_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    formatTeamPlanTaskTitle(normalized),
    toTaskStatus(normalized),
    TEAM_PLAN_TASK_DB_KIND,
    JSON.stringify(normalized.plan),
    normalized.approvalStatus,
    currentRunId,
    normalized.run.context.finalSummary || '',
    normalized.sourceMessageId || null,
    normalized.approvedAt || null,
    normalized.rejectedAt || null,
    normalized.lastActionAt || nowIso(),
    normalizeTimestamp(),
    taskId,
  );

  return getTask(taskId);
}

function getCurrentTeamPhase(record: TeamPlanTaskRecord): TeamRunStage | undefined {
  return record.run.phases.find((phase) => ['running', 'blocked', 'waiting', 'ready'].includes(phase.status))
    || record.run.phases.find((phase) => phase.status === 'done');
}

function buildTeamOutputs(record: TeamPlanTaskRecord): string[] {
  const outputs: string[] = [];

  if (record.run.context.finalSummary?.trim()) {
    outputs.push(record.run.context.finalSummary.trim());
  }
  if (record.run.context.summary?.trim() && !outputs.includes(record.run.context.summary.trim())) {
    outputs.push(record.run.context.summary.trim());
  }

  for (const phase of record.run.phases) {
    const result = phase.latestResult?.trim();
    if (phase.status === 'done' && result && !outputs.includes(result)) {
      outputs.push(result);
    }
  }

  return outputs.slice(0, 4);
}

function buildMainAgentConfigurationCatalog(): {
  agentPresets: AgentPresetDirectoryItem[];
  teamTemplates: TeamTemplateDirectoryItem[];
} {
  const rows = listMainAgentTemplateRows();
  const agentRows: Array<{ row: TemplateRow; record: AgentPresetRecord }> = [];
  const templateRows: Array<{ row: TemplateRow; record: TeamTemplateRecord }> = [];

  for (const row of rows) {
    const payload = parseTemplatePayload(row.content_skeleton);
    const agentPreset = parseAgentPresetRecord(payload);
    if (agentPreset) {
      agentRows.push({ row, record: agentPreset });
      continue;
    }

    const teamTemplate = parseTeamTemplateRecord(payload);
    if (teamTemplate) {
      templateRows.push({ row, record: teamTemplate });
    }
  }

  const agentNameMap = new Map(agentRows.map(({ row, record }) => [row.id, record.name]));
  const templateCountMap = new Map<string, number>();

  for (const { record } of templateRows) {
    for (const agentPresetId of record.agentPresetIds) {
      templateCountMap.set(agentPresetId, (templateCountMap.get(agentPresetId) || 0) + 1);
    }
  }

  const agentPresets = agentRows.map(({ row, record }) => ({
    id: row.id,
    source: 'user' as const,
    name: record.name,
    roleKind: record.roleKind,
    responsibility: record.responsibility,
    systemPrompt: record.systemPrompt,
    updatedAt: row.updated_at,
    ...(record.description ? { description: record.description } : {}),
    ...(record.collaborationStyle ? { collaborationStyle: record.collaborationStyle } : {}),
    ...(record.outputContract ? { outputContract: record.outputContract } : {}),
    templateCount: templateCountMap.get(row.id) || 0,
  }));

  const teamTemplates = templateRows.map(({ row, record }) => ({
    id: row.id,
    source: 'user' as const,
    name: record.name,
    summary: record.summary,
    agentPresetIds: record.agentPresetIds,
    agentPresetNames: record.agentPresetIds.map((agentPresetId) => agentNameMap.get(agentPresetId)).filter(Boolean) as string[],
    updatedAt: row.updated_at,
    ...(record.activationHint ? { activationHint: record.activationHint } : {}),
    ...(record.defaultGoal ? { defaultGoal: record.defaultGoal } : {}),
    ...(record.defaultOutcome ? { defaultOutcome: record.defaultOutcome } : {}),
    ...(record.notes ? { notes: record.notes } : {}),
  }));

  agentPresets.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  teamTemplates.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return { agentPresets, teamTemplates };
}

export function listMainAgentAgentPresets(): AgentPresetDirectoryItem[] {
  return buildMainAgentConfigurationCatalog().agentPresets;
}

export function listMainAgentTeamTemplates(): TeamTemplateDirectoryItem[] {
  return buildMainAgentConfigurationCatalog().teamTemplates;
}

function truncateForPrompt(value: string | undefined, maxLength = 220): string {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 3)}...`;
}

export function getMainAgentTeamConfigurationPrompt(): string {
  const { agentPresets, teamTemplates } = buildMainAgentConfigurationCatalog();
  if (agentPresets.length === 0 && teamTemplates.length === 0) {
    return '';
  }

  const lines = ['User-defined team configuration is available in Lumos.'];

  if (agentPresets.length > 0) {
    lines.push('', 'Agent presets:');
    for (const preset of agentPresets.slice(0, 12)) {
      const parts = [`- ${preset.name} [${preset.roleKind}]: ${truncateForPrompt(preset.responsibility, 120)}`];
      const collaboration = truncateForPrompt(preset.collaborationStyle, 120);
      const outputContract = truncateForPrompt(preset.outputContract, 120);
      if (collaboration) {
        parts.push(`Collaboration style: ${collaboration}`);
      }
      if (outputContract) {
        parts.push(`Output contract: ${outputContract}`);
      }
      parts.push(`System prompt guidance: ${truncateForPrompt(preset.systemPrompt, 180)}`);
      lines.push(parts.join(' '));
    }
  }

  if (teamTemplates.length > 0) {
    lines.push('', 'Team templates:');
    for (const template of teamTemplates.slice(0, 8)) {
      const parts = [`- ${template.name}: ${truncateForPrompt(template.summary, 140)}`];
      if (template.agentPresetNames.length > 0) {
        parts.push(`Agents: ${template.agentPresetNames.join(', ')}.`);
      }
      if (template.activationHint) {
        parts.push(`Use when: ${truncateForPrompt(template.activationHint, 140)}`);
      }
      if (template.defaultOutcome) {
        parts.push(`Default outcome: ${truncateForPrompt(template.defaultOutcome, 140)}`);
      }
      lines.push(parts.join(' '));
    }
  }

  lines.push(
    '',
    'When Team Mode fits the request, prefer these user-defined presets or templates when they clearly match the goal. Keep Main Agent as the only user-facing role.',
  );

  return lines.join('\n');
}

function getMainAgentSessionRuntimeTaskCandidates(
  sessionId: string,
): Array<{ task: TaskItem; record: TeamPlanTaskRecord }> {
  const teamTasks = getTasksBySession(sessionId, { kind: TEAM_PLAN_TASK_KIND });
  if (teamTasks.length === 0) {
    return [];
  }

  return teamTasks
    .map((task, index) => ({
      task,
      record: parseTeamPlanTaskRecord(task.description),
      sourceIndex: index,
    }))
    .filter((item): item is { task: TaskItem; record: TeamPlanTaskRecord; sourceIndex: number } => Boolean(item.record))
    .sort((left, right) => {
      const updatedOrder = right.task.updated_at.localeCompare(left.task.updated_at);
      if (updatedOrder !== 0) {
        return updatedOrder;
      }
      const createdOrder = right.task.created_at.localeCompare(left.task.created_at);
      if (createdOrder !== 0) {
        return createdOrder;
      }
      return right.sourceIndex - left.sourceIndex;
    })
    .map(({ task, record }) => ({ task, record }));
}

function getMainAgentRuntimeDeliverablePaths(runId: string | undefined): string[] {
  if (!runId) {
    return [];
  }

  const db = getDb();
  const existingFinalSummaryArtifact = db.prepare(`
    SELECT id
    FROM team_run_artifacts
    WHERE run_id = ? AND source_path = 'final-summary.md'
    LIMIT 1
  `).get(runId) as { id: string } | undefined;

  if (!existingFinalSummaryArtifact) {
    const run = db.prepare(`
      SELECT final_summary
      FROM team_runs
      WHERE id = ?
      LIMIT 1
    `).get(runId) as { final_summary: string } | undefined;
    const stage = db.prepare(`
      SELECT id
      FROM team_run_stages
      WHERE run_id = ?
      ORDER BY completed_at DESC, created_at DESC, id DESC
      LIMIT 1
    `).get(runId) as { id: string } | undefined;

    if (run?.final_summary?.trim() && stage?.id) {
      const content = Buffer.from(run.final_summary.trim(), 'utf8');
      db.prepare(`
        INSERT INTO team_run_artifacts (id, run_id, stage_id, type, title, source_path, content, content_type, size, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomBytes(16).toString('hex'),
        runId,
        stage.id,
        'output',
        'Final summary',
        'final-summary.md',
        content,
        'text/markdown',
        content.length,
        Date.now(),
      );
    }
  }

  const rows = db.prepare(`
    SELECT id, title, source_path, content_type
    FROM team_run_artifacts
    WHERE run_id = ?
    ORDER BY
      CASE
        WHEN source_path = 'final-summary.md' THEN 0
        WHEN content_type = 'text/markdown' THEN 1
        WHEN source_path LIKE '%.md' THEN 2
        WHEN title LIKE '%report%' OR title LIKE '%summary%' THEN 3
        ELSE 9
      END,
      created_at ASC,
      id ASC
  `).all(runId) as Array<{
    id: string;
    title: string;
    source_path: string | null;
    content_type: string;
  }>;

  return rows
    .slice(0, 4)
    .map((row) => {
      const label = row.source_path?.trim() || row.title.trim();
      const path = `/api/team-runs/${runId}/artifacts/${row.id}`;
      return label ? `${label} -> ${path}` : path;
    });
}

function toMainAgentSessionRuntimeTaskView(
  item: { task: TaskItem; record: TeamPlanTaskRecord },
): MainAgentSessionTeamRuntimeTaskView {
  const currentPhase = getCurrentTeamPhase(item.record);
  const outputs = buildTeamOutputs(item.record);

  return {
    taskId: item.task.id,
    title: item.record.plan.summary,
    userGoal: item.record.plan.userGoal,
    approvalStatus: item.record.approvalStatus,
    runStatus: item.record.approvalStatus === 'approved' ? item.record.run.status : 'not_started',
    publishedToChat: Boolean(item.record.run.context.publishedAt),
    ...(currentPhase && !['done', 'failed', 'blocked', 'cancelled'].includes(item.record.run.status)
      ? { currentStage: currentPhase.title }
      : {}),
    ...(item.record.run.context.finalSummary.trim()
      ? { finalSummary: item.record.run.context.finalSummary.trim() }
      : {}),
    ...(outputs[0] ? { latestOutput: outputs[0] } : {}),
    ...(item.task.current_run_id ? { runId: item.task.current_run_id } : {}),
    deliverablePaths: getMainAgentRuntimeDeliverablePaths(item.task.current_run_id || undefined),
    updatedAt: item.task.updated_at,
  };
}

export function getMainAgentSessionTeamRuntimeState(
  sessionId: string,
): MainAgentSessionTeamRuntimeState | null {
  const runtimeTasks = getMainAgentSessionRuntimeTaskCandidates(sessionId);
  if (runtimeTasks.length === 0) {
    return null;
  }

  const activeApprovedTask = runtimeTasks.find(({ record }) => (
    record.approvalStatus === 'approved'
    && !['done', 'failed', 'blocked', 'cancelled'].includes(record.run.status)
  ));
  const latestApprovedTask = runtimeTasks.find(({ record }) => record.approvalStatus === 'approved');
  const latestApprovedIndex = latestApprovedTask
    ? runtimeTasks.findIndex(({ task }) => task.id === latestApprovedTask.task.id)
    : -1;
  const relevantPendingTasks = runtimeTasks.filter(({ record }, index) => (
    record.approvalStatus === 'pending'
    && (latestApprovedIndex === -1 || index < latestApprovedIndex)
  ));
  const preferredTask = activeApprovedTask || latestApprovedTask || null;
  const additionalTasks = runtimeTasks.filter(({ task }) => (
    (!preferredTask || task.id !== preferredTask.task.id)
    && !relevantPendingTasks.some((item) => item.task.id === task.id)
  ));

  return {
    preferredTask: preferredTask ? toMainAgentSessionRuntimeTaskView(preferredTask) : null,
    pendingTasks: relevantPendingTasks.slice(0, 2).map(toMainAgentSessionRuntimeTaskView),
    additionalTasks: additionalTasks.slice(0, 3).map(toMainAgentSessionRuntimeTaskView),
  };
}

function appendMainAgentRuntimeTaskPrompt(
  lines: string[],
  header: string,
  task: MainAgentSessionTeamRuntimeTaskView,
): void {
  const finalSummary = truncateForPrompt(task.finalSummary, 1600);
  const latestOutput = truncateForPrompt(task.latestOutput, 700);

  lines.push('');
  lines.push(header);
  lines.push(`- Task: ${task.title}`);
  lines.push(`  Goal: ${truncateForPrompt(task.userGoal, 220)}`);
  lines.push(`  Approval: ${task.approvalStatus}`);
  lines.push(`  Run status: ${task.runStatus}`);
  lines.push(`  Published to chat: ${task.publishedToChat ? 'yes' : 'no'}`);
  if (task.currentStage) {
    lines.push(`  Current stage: ${task.currentStage}`);
  }
  if (finalSummary) {
    lines.push(`  Final summary: ${finalSummary}`);
  } else if (latestOutput) {
    lines.push(`  Latest output: ${latestOutput}`);
  }
  if (task.deliverablePaths.length > 0) {
    lines.push('  Deliverable paths:');
    for (const item of task.deliverablePaths) {
      lines.push(`  - ${item}`);
    }
  } else if (task.finalSummary) {
    lines.push('  Deliverable note: no separate runtime artifact path was persisted; use the published chat summary as the canonical report.');
  }
  if (task.runId) {
    lines.push(`  Run ID: ${task.runId}`);
  }
}

export function getMainAgentSessionTeamRuntimePrompt(sessionId: string): string {
  const runtimeState = getMainAgentSessionTeamRuntimeState(sessionId);
  if (!runtimeState) {
    return '';
  }

  const lines = [
    'Team task runtime state is available for this Main Agent session.',
    'Treat this runtime state as the source of truth over stale chat history about whether the team only planned or actually executed.',
    'If the user asks for a report, output, result, or deliverable from an existing team task, use the completed task state below instead of saying execution has not happened.',
    'If a task is already approved, running, or done, do not ask the user to approve or confirm it again.',
    'For unrelated requests such as time, casual chat, or simple Q&A, answer directly and do not volunteer team approval reminders.',
    'If the user asks where the report is, return the deliverable path or artifact URL directly when one is available.',
  ];

  if (runtimeState.preferredTask) {
    appendMainAgentRuntimeTaskPrompt(lines, 'Primary team task to use as current truth:', runtimeState.preferredTask);
  }

  if (runtimeState.pendingTasks.length > 0) {
    lines.push('');
    lines.push('Pending team plans that still require approval:');
    lines.push('Only mention these if the user explicitly asks what still needs approval or wants to start a new team plan.');
    for (const pendingTask of runtimeState.pendingTasks) {
      appendMainAgentRuntimeTaskPrompt(lines, 'Pending team task:', pendingTask);
    }
  }

  for (const task of runtimeState.additionalTasks) {
    appendMainAgentRuntimeTaskPrompt(lines, 'Additional recent team task:', task);
  }

  return lines.join('\n');
}

export function getTasksBySession(
  sessionId: string,
  options: GetTasksBySessionOptions = {},
): TaskItem[] {
  const rows = getRawTasksBySession(sessionId).map(materializeTask);

  if (options.kind === TEAM_PLAN_TASK_KIND) {
    return rows.filter((task) => buildTeamPlanTaskRecord(task) !== null);
  }
  if (options.includeSystem) {
    return rows;
  }
  return rows.filter((task) => !isSystemTask(task));
}

export function getTask(id: string): TaskItem | undefined {
  const row = getRawTask(id);
  return row ? materializeTask(row) : undefined;
}

export function ensureSessionTeamRunsExecution(sessionId: string): void {
  const teamTasks = getRawTasksBySession(sessionId).filter((task) => task.current_run_id);
  for (const task of teamTasks) {
    ensureTaskRunScheduled(task.id);
  }
}

export function createTask(sessionId: string, title: string, description?: string): TaskItem {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  db.prepare(
    'INSERT INTO tasks (id, session_id, title, status, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, sessionId, title, 'pending', description || null, now, now);

  return getTask(id)!;
}

export function updateTask(id: string, updates: { title?: string; status?: TaskStatus; description?: string }): TaskItem | undefined {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const existing = getRawTask(id);
  if (!existing) return undefined;

  const title = updates.title ?? existing.title;
  const status = updates.status ?? existing.status;
  const description = updates.description !== undefined ? updates.description : existing.description;

  db.prepare(
    'UPDATE tasks SET title = ?, status = ?, description = ?, updated_at = ? WHERE id = ?'
  ).run(title, status, description, now, id);

  return getTask(id);
}

export function deleteTask(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return result.changes > 0;
}

function getLatestTeamPlanTask(sessionId: string): TaskItem | undefined {
  const teamTasks = getTasksBySession(sessionId, { kind: TEAM_PLAN_TASK_KIND });
  return teamTasks[teamTasks.length - 1];
}

export function upsertTeamPlanTask(
  sessionId: string,
  record: TeamPlanTaskRecord,
): TaskItem {
  const normalized = normalizeTeamPlanRecord(record);
  const existing = getLatestTeamPlanTask(sessionId);
  const existingRecord = existing ? parseTeamPlanTaskRecord(existing.description) : null;
  const canReuseExisting = existingRecord?.approvalStatus === 'pending' && !existingRecord.run.createdAt;

  if (!existing || !canReuseExisting) {
    const created = createTask(
      sessionId,
      formatTeamPlanTaskTitle(normalized),
      undefined,
    );
    const result = persistTeamPlanRecord(created.id, normalized) || created;
    taskEventBus.emitTaskEvent({
      type: 'task:created',
      sessionId,
      taskId: result.id,
      timestamp: Date.now(),
      data: { approvalStatus: normalized.approvalStatus },
    });
    return result;
  }

  const result = persistTeamPlanRecord(existing.id, normalized) || existing;
  taskEventBus.emitTaskEvent({
    type: 'task:updated',
    sessionId,
    taskId: result.id,
    timestamp: Date.now(),
    data: { approvalStatus: normalized.approvalStatus },
  });
  return result;
}

