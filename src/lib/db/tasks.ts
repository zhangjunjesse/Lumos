import crypto from 'crypto';
import {
  createTeamRunSkeleton,
  MAIN_AGENT_AGENT_PRESET_KIND,
  MAIN_AGENT_TEAM_TEMPLATE_KIND,
  TEAM_PLAN_TASK_KIND,
  parseAgentPresetRecord,
  parseTeamPlanTaskRecord,
  parseTeamTemplateRecord,
  serializeAgentPresetRecord,
  serializeTeamPlanTaskRecord,
  serializeTeamTemplateRecord,
} from '@/types';
import type {
  AgentPresetDirectoryItem,
  AgentPresetRecord,
  ChatSession,
  CreateAgentPresetRequest,
  CreateTeamTemplateRequest,
  TaskArtifactItem,
  TaskDirectoryItem,
  TaskDirectorySource,
  TaskItem,
  TaskStatus,
  TeamAgentPresetRoleKind,
  TeamRoleDirectoryItem,
  TeamPlan,
  TeamPlanApprovalStatus,
  TeamDirectoryItem,
  TeamPlanTaskRecord,
  TeamTemplateDirectoryItem,
  TeamTemplateRecord,
  TeamRun,
  TeamRunContext,
  TeamRunStage,
  TeamRunStatus,
  UpdateAgentPresetRequest,
  UpdateTeamTemplateRequest,
} from '@/types';
import { isMainAgentSession } from '@/lib/chat/session-entry';
import { getDb } from './connection';
import { addMessage } from './sessions';
import { getAllSessions } from './sessions';

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

interface TeamRunAutomationState {
  timer: ReturnType<typeof setTimeout> | null;
  phaseStartedAt: Record<string, number>;
  isTicking: boolean;
}

type TeamRunAutomationStore = Map<string, TeamRunAutomationState>;

type GlobalWithTeamRunAutomationStore = typeof globalThis & {
  __lumosTeamRunAutomationStore?: TeamRunAutomationStore;
};

const AUTO_TEAM_RUN_BOOT_DELAY_MS = 80;
const AUTO_TEAM_RUN_TICK_MS = 1200;
const AUTO_TEAM_RUN_PHASE_DURATION_MS = 3200;

function normalizeTimestamp(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

function getTeamRunAutomationStore(): TeamRunAutomationStore {
  const runtime = globalThis as GlobalWithTeamRunAutomationStore;
  if (!runtime.__lumosTeamRunAutomationStore) {
    runtime.__lumosTeamRunAutomationStore = new Map<string, TeamRunAutomationState>();
  }
  return runtime.__lumosTeamRunAutomationStore;
}

function getTeamRunAutomationState(taskId: string): TeamRunAutomationState {
  const store = getTeamRunAutomationStore();
  const existing = store.get(taskId);
  if (existing) return existing;

  const created: TeamRunAutomationState = {
    timer: null,
    phaseStartedAt: {},
    isTicking: false,
  };
  store.set(taskId, created);
  return created;
}

function clearTeamRunAutomation(taskId: string): void {
  const store = getTeamRunAutomationStore();
  const state = store.get(taskId);
  if (state?.timer) {
    clearTimeout(state.timer);
  }
  store.delete(taskId);
}

function hasTemplatesTable(): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'templates'")
    .get() as { name?: string } | undefined;
  return row?.name === 'templates';
}

function ensureTemplatesTable(): void {
  if (!hasTemplatesTable()) {
    throw new Error('templates table is not available');
  }
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

function getMainAgentTemplateRow(id: string): TemplateRow | undefined {
  if (!hasTemplatesTable()) return undefined;
  const db = getDb();
  return db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as TemplateRow | undefined;
}

function normalizeOptionalText(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function requireText(value: string | undefined, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${field} is required`);
  }
  return trimmed;
}

function normalizeAgentPresetIds(ids: string[] | undefined): string[] {
  if (!Array.isArray(ids)) return [];
  return Array.from(
    new Set(
      ids
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

function validateAgentRoleKind(roleKind: string | undefined): TeamAgentPresetRoleKind {
  if (roleKind === 'orchestrator' || roleKind === 'lead' || roleKind === 'worker') {
    return roleKind;
  }
  throw new Error('roleKind must be orchestrator, lead, or worker');
}

function isSystemTask(task: TaskItem): boolean {
  return parseTeamPlanTaskRecord(task.description) !== null;
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
  if (record.run.status === 'failed' || record.run.status === 'blocked') {
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
  return ['done', 'failed', 'blocked'].includes(status);
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

function buildAutoPhaseResult(
  record: TeamPlanTaskRecord,
  phase: TeamRunStage,
  phases: TeamRunStage[],
): string {
  const owner = record.plan.roles.find((role) => role.id === phase.ownerRoleId);
  const planTask = record.plan.tasks.find((task) => task.id === phase.planTaskId);
  const dependencyHighlights = phases
    .filter((candidate) => phase.dependsOn.includes(candidate.planTaskId))
    .map((candidate) => `- ${candidate.title}: ${(candidate.latestResult || candidate.expectedOutput).trim()}`)
    .slice(0, 3);

  return [
    `${owner?.name || '团队成员'}已完成「${phase.title}」阶段交付。`,
    planTask?.summary ? `阶段目标：${planTask.summary}` : null,
    dependencyHighlights.length > 0 ? '上游输入：' : null,
    ...dependencyHighlights,
    `当前产出：${phase.expectedOutput}`,
    '执行说明：当前为 Main Agent / Team Mode MVP 的自动执行骨架结果，用于验证任务自动启动、状态推进与结果回填链路。',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')
    .trim();
}

function buildMainAgentCompletionMessage(taskId: string, record: TeamPlanTaskRecord, run: TeamRun): string {
  const summary = run.context.finalSummary.trim()
    || run.context.summary.trim()
    || record.plan.expectedOutcome.trim()
    || '团队已完成本次任务，请打开任务页查看阶段结果与最终汇总。';

  return [
    '主代理团队任务已完成。',
    `任务：${record.plan.summary}`,
    `任务页：/tasks/${taskId}`,
    `团队页：/team/${taskId}`,
    '',
    summary,
  ].join('\n').trim();
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

function persistTeamPlanRecord(taskId: string, record: TeamPlanTaskRecord): TaskItem | undefined {
  const normalized = normalizeTeamPlanRecord(record);
  return updateTask(taskId, {
    title: formatTeamPlanTaskTitle(normalized),
    description: serializeTeamPlanTaskRecord(normalized),
    status: toTaskStatus(normalized),
  });
}

function scheduleTeamRunTick(taskId: string, delayMs = AUTO_TEAM_RUN_BOOT_DELAY_MS): void {
  const state = getTeamRunAutomationState(taskId);
  if (state.timer) return;

  state.timer = setTimeout(() => {
    const current = getTeamRunAutomationState(taskId);
    current.timer = null;
    runAutomatedTeamRunTick(taskId);
  }, Math.max(AUTO_TEAM_RUN_BOOT_DELAY_MS, delayMs));
}

function runAutomatedTeamRunTick(taskId: string): void {
  const state = getTeamRunAutomationState(taskId);
  if (state.isTicking) return;

  state.isTicking = true;

  try {
    const task = getTask(taskId);
    if (!task) {
      clearTeamRunAutomation(taskId);
      return;
    }

    const record = parseTeamPlanTaskRecord(task.description);
    if (!record || record.approvalStatus !== 'approved') {
      clearTeamRunAutomation(taskId);
      return;
    }

    if (isTerminalTeamRunStatus(record.run.status)) {
      clearTeamRunAutomation(taskId);
      return;
    }

    const now = nowIso();
    const runtimeNow = Date.now();
    let phases = unlockReadyPhases(record.run.phases);
    let changed = JSON.stringify(phases) !== JSON.stringify(record.run.phases);

    const completedRunningIds = phases
      .filter((phase) => phase.status === 'running')
      .filter((phase) => {
        if (!state.phaseStartedAt[phase.id]) {
          state.phaseStartedAt[phase.id] = runtimeNow;
        }
        return runtimeNow - state.phaseStartedAt[phase.id] >= AUTO_TEAM_RUN_PHASE_DURATION_MS;
      })
      .map((phase) => phase.id);

    if (completedRunningIds.length > 0) {
      phases = unlockReadyPhases(phases.map((phase) => {
        if (!completedRunningIds.includes(phase.id)) return phase;
        delete state.phaseStartedAt[phase.id];
        return {
          ...phase,
          status: 'done',
          latestResult: buildAutoPhaseResult(record, phase, phases),
          updatedAt: now,
        };
      }));
      changed = true;
    }

    const maxParallelWorkers = Math.max(1, record.run.budget.maxParallelWorkers || 1);
    const runningCount = phases.filter((phase) => phase.status === 'running').length;
    const phaseIdsToStart = phases
      .filter((phase) => phase.status === 'ready')
      .slice(0, Math.max(0, maxParallelWorkers - runningCount))
      .map((phase) => phase.id);

    if (phaseIdsToStart.length > 0) {
      phases = phases.map((phase) => {
        if (!phaseIdsToStart.includes(phase.id)) return phase;
        state.phaseStartedAt[phase.id] = runtimeNow;
        return {
          ...phase,
          status: 'running',
          updatedAt: now,
        };
      });
      changed = true;
    }

    for (const phaseId of Object.keys(state.phaseStartedAt)) {
      const phase = phases.find((candidate) => candidate.id === phaseId);
      if (!phase || phase.status !== 'running') {
        delete state.phaseStartedAt[phaseId];
      }
    }

    const status = deriveRunStatus(phases);
    const shouldPublishToMainChat = status === 'done' && !record.run.context.publishedAt;

    if (changed || status !== record.run.status || shouldPublishToMainChat) {
      const nextRun = applyAutomaticContextBackfill(record, {
        ...record.run,
        phases,
        status,
        startedAt: record.run.startedAt || (shouldMarkRunStarted(status) ? now : record.run.startedAt),
        completedAt: status === 'done' ? now : null,
        lastUpdatedAt: now,
        context: {
          ...record.run.context,
          blockedReason: status === 'blocked' ? record.run.context.blockedReason : undefined,
          lastError: status === 'failed' ? record.run.context.lastError : undefined,
          ...(shouldPublishToMainChat ? { publishedAt: now } : {}),
        },
      });

      const nextRecord: TeamPlanTaskRecord = {
        ...record,
        run: nextRun,
        lastActionAt: now,
      };

      persistTeamPlanRecord(taskId, nextRecord);

      if (shouldPublishToMainChat) {
        try {
          addMessage(task.session_id, 'assistant', buildMainAgentCompletionMessage(taskId, nextRecord, nextRun));
        } catch {
          // Best effort only.
        }
      }

      if (isTerminalTeamRunStatus(status)) {
        clearTeamRunAutomation(taskId);
        return;
      }
    }

    scheduleTeamRunTick(taskId, AUTO_TEAM_RUN_TICK_MS);
  } finally {
    state.isTicking = false;
  }
}

function buildTaskPath(taskId: string): string {
  return `/tasks/${taskId}`;
}

function buildTeamPath(teamId: string): string {
  return `/team/${teamId}`;
}

function summarizeTeamExecutors(record: TeamPlanTaskRecord): string {
  const roleNames = record.plan.roles
    .filter((role) => role.kind !== 'main_agent')
    .map((role) => role.name);

  if (roleNames.length === 0) {
    return '主代理';
  }

  if (roleNames.length === 1) {
    return roleNames[0];
  }

  if (roleNames.length === 2) {
    return roleNames.join(' / ');
  }

  return `${roleNames[0]} / ${roleNames[1]} / +${roleNames.length - 2}`;
}

function getCurrentTeamPhase(record: TeamPlanTaskRecord): TeamRunStage | undefined {
  return record.run.phases.find((phase) => ['running', 'blocked', 'waiting', 'ready'].includes(phase.status))
    || record.run.phases.find((phase) => phase.status === 'done');
}

function buildTeamArtifacts(record: TeamPlanTaskRecord, task: TaskItem): TaskArtifactItem[] {
  const roleMap = new Map(record.plan.roles.map((role) => [role.id, role]));
  const planTaskMap = new Map(record.plan.tasks.map((planTask) => [planTask.id, planTask]));

  return record.run.phases.map((phase) => {
    const owner = roleMap.get(phase.ownerRoleId);
    const planTask = planTaskMap.get(phase.planTaskId);
    return {
      id: phase.id,
      title: phase.title,
      summary: phase.latestResult?.trim() || planTask?.summary || '',
      status: phase.status,
      updatedAt: phase.updatedAt || task.updated_at,
      ...(owner ? { ownerName: owner.name } : {}),
      ...(phase.expectedOutput ? { expectedOutput: phase.expectedOutput } : {}),
      dependsOn: phase.dependsOn,
    };
  });
}

function buildTeamRoles(record: TeamPlanTaskRecord): TeamRoleDirectoryItem[] {
  return record.plan.roles
    .filter((role) => role.kind !== 'main_agent')
    .map((role) => ({
      id: role.id,
      name: role.name,
      kind: role.kind,
      responsibility: role.responsibility,
      ...(role.parentRoleId ? { parentRoleId: role.parentRoleId } : {}),
    }));
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

function toTeamDirectoryItem(
  session: ChatSession,
  task: TaskItem,
  record: TeamPlanTaskRecord,
): TeamDirectoryItem {
  const currentPhase = getCurrentTeamPhase(record);
  const outputs = buildTeamOutputs(record);
  const artifacts = buildTeamArtifacts(record, task);
  const roles = buildTeamRoles(record);
  const currentExecutorName = currentPhase
    ? record.plan.roles.find((role) => role.id === currentPhase.ownerRoleId)?.name
    : undefined;
  return {
    id: task.id,
    sessionId: session.id,
    sessionTitle: session.title,
    workingDirectory: session.working_directory,
    projectName: session.project_name,
    title: record.plan.summary,
    summary: record.plan.summary,
    userGoal: record.plan.userGoal,
    expectedOutcome: record.plan.expectedOutcome,
    approvalStatus: record.approvalStatus,
    runStatus: record.run.status,
    roleCount: roles.length,
    taskCount: record.plan.tasks.length,
    completedTaskCount: record.run.phases.filter((phase) => phase.status === 'done').length,
    updatedAt: task.updated_at,
    relatedTaskId: task.id,
    relatedTaskPath: buildTaskPath(task.id),
    teamPath: buildTeamPath(task.id),
    executorLabel: summarizeTeamExecutors(record),
    createdScenario: record.plan.userGoal,
    roles,
    outputs,
    artifacts,
    ...(currentPhase ? { currentStage: currentPhase.title } : {}),
    ...(currentExecutorName ? { currentExecutorName } : {}),
    ...(outputs[0] ? { latestOutput: outputs[0] } : {}),
    ...(record.run.context.blockedReason ? { blockedReason: record.run.context.blockedReason } : {}),
    ...(record.run.context.finalSummary?.trim() ? { finalSummary: record.run.context.finalSummary.trim() } : {}),
  };
}

function toTaskDirectoryItem(
  session: ChatSession,
  task: TaskItem,
  source: TaskDirectorySource,
  overrides: Omit<TaskDirectoryItem, 'id' | 'source' | 'sessionId' | 'sessionTitle' | 'workingDirectory' | 'projectName' | 'updatedAt'>,
): TaskDirectoryItem {
  return {
    id: task.id,
    source,
    sessionId: session.id,
    sessionTitle: session.title,
    workingDirectory: session.working_directory,
    projectName: session.project_name,
    updatedAt: task.updated_at,
    ...overrides,
  };
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

function buildTeamTaskDirectoryItem(
  session: ChatSession,
  task: TaskItem,
  record: TeamPlanTaskRecord,
): TaskDirectoryItem {
  const completedCount = record.run.phases.filter((phase) => phase.status === 'done').length;
  const currentPhase = getCurrentTeamPhase(record);
  const outputs = buildTeamOutputs(record);
  const artifacts = buildTeamArtifacts(record, task);
  const currentExecutorName = currentPhase
    ? record.plan.roles.find((role) => role.id === currentPhase.ownerRoleId)?.name
    : undefined;

  return toTaskDirectoryItem(session, task, 'team', {
    title: record.plan.summary,
    summary: record.plan.expectedOutcome,
    status: record.run.status,
    executionMode: 'team_mode',
    createdScenario: record.plan.userGoal,
    executorLabel: summarizeTeamExecutors(record),
    progressCompleted: completedCount,
    progressTotal: record.plan.tasks.length,
    outputs,
    artifacts,
    taskPath: buildTaskPath(task.id),
    ...(currentPhase ? { currentStage: currentPhase.title } : {}),
    ...(currentExecutorName ? { currentExecutorName } : {}),
    ...(outputs[0] ? { latestOutput: outputs[0] } : {}),
    ...(record.plan.userGoal ? { userGoal: record.plan.userGoal } : {}),
    approvalStatus: record.approvalStatus,
    dependsOn: [],
    teamId: task.id,
    teamTitle: record.plan.summary,
    expectedOutput: record.plan.expectedOutcome,
  });
}

export function getMainAgentCatalog(): {
  teams: TeamDirectoryItem[];
  tasks: TaskDirectoryItem[];
  agentPresets: AgentPresetDirectoryItem[];
  teamTemplates: TeamTemplateDirectoryItem[];
} {
  ensureMainAgentTeamRunsExecution();
  const sessions = getAllSessions().filter((session) => isMainAgentSession(session));
  const teams: TeamDirectoryItem[] = [];
  const tasks: TaskDirectoryItem[] = [];

  for (const session of sessions) {
    const sessionTasks = getTasksBySession(session.id, { includeSystem: true });
    for (const task of sessionTasks) {
      const teamRecord = parseTeamPlanTaskRecord(task.description);
      if (teamRecord) {
        teams.push(toTeamDirectoryItem(session, task, teamRecord));
        tasks.push(buildTeamTaskDirectoryItem(session, task, teamRecord));
        continue;
      }

      tasks.push(toTaskDirectoryItem(session, task, 'manual', {
        title: task.title,
        summary: task.description?.trim() || '',
        status: task.status,
        executionMode: 'main_agent',
        createdScenario: session.title || task.title,
        executorLabel: '主代理',
        progressCompleted: task.status === 'completed' ? 1 : 0,
        progressTotal: 1,
        outputs: task.status === 'completed' && task.description?.trim() ? [task.description.trim()] : [],
        artifacts: [],
        taskPath: buildTaskPath(task.id),
        dependsOn: [],
      }));
    }
  }

  teams.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  tasks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return {
    teams,
    tasks,
    ...buildMainAgentConfigurationCatalog(),
  };
}

export function getMainAgentTaskDirectoryItem(taskId: string): TaskDirectoryItem | undefined {
  ensureTeamRunExecution(taskId);
  return getMainAgentCatalog().tasks.find((task) => task.id === taskId);
}

export function getMainAgentTeamDirectoryItem(teamId: string): TeamDirectoryItem | undefined {
  ensureTeamRunExecution(teamId);
  return getMainAgentCatalog().teams.find((team) => team.id === teamId);
}

export function listMainAgentAgentPresets(): AgentPresetDirectoryItem[] {
  return buildMainAgentConfigurationCatalog().agentPresets;
}

export function listMainAgentTeamTemplates(): TeamTemplateDirectoryItem[] {
  return buildMainAgentConfigurationCatalog().teamTemplates;
}

function getValidatedAgentPresetRecord(
  input: CreateAgentPresetRequest | UpdateAgentPresetRequest,
  existing?: AgentPresetRecord,
): AgentPresetRecord {
  const roleKind = input.roleKind ?? existing?.roleKind;
  return {
    kind: MAIN_AGENT_AGENT_PRESET_KIND,
    version: 1,
    name: requireText(input.name ?? existing?.name, 'name'),
    roleKind: validateAgentRoleKind(roleKind),
    responsibility: requireText(input.responsibility ?? existing?.responsibility, 'responsibility'),
    systemPrompt: requireText(input.systemPrompt ?? existing?.systemPrompt, 'systemPrompt'),
    ...(normalizeOptionalText(input.description ?? existing?.description) ? { description: normalizeOptionalText(input.description ?? existing?.description) } : {}),
    ...(normalizeOptionalText(input.collaborationStyle ?? existing?.collaborationStyle)
      ? { collaborationStyle: normalizeOptionalText(input.collaborationStyle ?? existing?.collaborationStyle) }
      : {}),
    ...(normalizeOptionalText(input.outputContract ?? existing?.outputContract)
      ? { outputContract: normalizeOptionalText(input.outputContract ?? existing?.outputContract) }
      : {}),
  };
}

function getValidatedTeamTemplateRecord(
  input: CreateTeamTemplateRequest | UpdateTeamTemplateRequest,
  existing?: TeamTemplateRecord,
): TeamTemplateRecord {
  const agentPresetIds = normalizeAgentPresetIds(input.agentPresetIds ?? existing?.agentPresetIds);
  if (agentPresetIds.length === 0) {
    throw new Error('agentPresetIds must include at least one agent preset');
  }

  const presetMap = new Map(listMainAgentAgentPresets().map((item) => [item.id, item]));
  for (const agentPresetId of agentPresetIds) {
    if (!presetMap.has(agentPresetId)) {
      throw new Error(`Unknown agent preset: ${agentPresetId}`);
    }
  }

  return {
    kind: MAIN_AGENT_TEAM_TEMPLATE_KIND,
    version: 1,
    name: requireText(input.name ?? existing?.name, 'name'),
    summary: requireText(input.summary ?? existing?.summary, 'summary'),
    agentPresetIds,
    ...(normalizeOptionalText(input.activationHint ?? existing?.activationHint)
      ? { activationHint: normalizeOptionalText(input.activationHint ?? existing?.activationHint) }
      : {}),
    ...(normalizeOptionalText(input.defaultGoal ?? existing?.defaultGoal)
      ? { defaultGoal: normalizeOptionalText(input.defaultGoal ?? existing?.defaultGoal) }
      : {}),
    ...(normalizeOptionalText(input.defaultOutcome ?? existing?.defaultOutcome)
      ? { defaultOutcome: normalizeOptionalText(input.defaultOutcome ?? existing?.defaultOutcome) }
      : {}),
    ...(normalizeOptionalText(input.notes ?? existing?.notes)
      ? { notes: normalizeOptionalText(input.notes ?? existing?.notes) }
      : {}),
  };
}

function getAgentPresetDirectoryItem(id: string): AgentPresetDirectoryItem | undefined {
  return listMainAgentAgentPresets().find((item) => item.id === id);
}

function getTeamTemplateDirectoryItem(id: string): TeamTemplateDirectoryItem | undefined {
  return listMainAgentTeamTemplates().find((item) => item.id === id);
}

export function createMainAgentAgentPreset(input: CreateAgentPresetRequest): AgentPresetDirectoryItem {
  ensureTemplatesTable();
  const record = getValidatedAgentPresetRecord(input);
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = normalizeTimestamp();

  db.prepare(`
    INSERT INTO templates (id, name, type, category, content_skeleton, system_prompt, opening_message, ai_config, icon, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    record.name,
    'conversation',
    'user',
    serializeAgentPresetRecord(record),
    record.systemPrompt,
    '',
    JSON.stringify({ feature: 'main-agent-team', recordKind: MAIN_AGENT_AGENT_PRESET_KIND }),
    'A',
    record.description || record.responsibility,
    now,
    now,
  );

  const created = getAgentPresetDirectoryItem(id);
  if (!created) {
    throw new Error('Failed to create agent preset');
  }
  return created;
}

export function updateMainAgentAgentPreset(id: string, updates: UpdateAgentPresetRequest): AgentPresetDirectoryItem | undefined {
  ensureTemplatesTable();
  const row = getMainAgentTemplateRow(id);
  if (!row) return undefined;

  const existing = parseAgentPresetRecord(parseTemplatePayload(row.content_skeleton));
  if (!existing) return undefined;

  const record = getValidatedAgentPresetRecord(updates, existing);
  const db = getDb();
  const now = normalizeTimestamp();

  db.prepare(`
    UPDATE templates
    SET name = ?, content_skeleton = ?, system_prompt = ?, description = ?, updated_at = ?
    WHERE id = ?
  `).run(
    record.name,
    serializeAgentPresetRecord(record),
    record.systemPrompt,
    record.description || record.responsibility,
    now,
    id,
  );

  return getAgentPresetDirectoryItem(id);
}

export function deleteMainAgentAgentPreset(id: string): boolean {
  ensureTemplatesTable();
  const preset = getAgentPresetDirectoryItem(id);
  if (!preset) return false;
  if (preset.templateCount > 0) {
    throw new Error('Agent preset is still referenced by one or more team templates');
  }

  const db = getDb();
  return db.prepare('DELETE FROM templates WHERE id = ?').run(id).changes > 0;
}

export function createMainAgentTeamTemplate(input: CreateTeamTemplateRequest): TeamTemplateDirectoryItem {
  ensureTemplatesTable();
  const record = getValidatedTeamTemplateRecord(input);
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = normalizeTimestamp();

  db.prepare(`
    INSERT INTO templates (id, name, type, category, content_skeleton, system_prompt, opening_message, ai_config, icon, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    record.name,
    'conversation',
    'user',
    serializeTeamTemplateRecord(record),
    record.notes || '',
    '',
    JSON.stringify({ feature: 'main-agent-team', recordKind: MAIN_AGENT_TEAM_TEMPLATE_KIND }),
    'T',
    record.summary,
    now,
    now,
  );

  const created = getTeamTemplateDirectoryItem(id);
  if (!created) {
    throw new Error('Failed to create team template');
  }
  return created;
}

export function updateMainAgentTeamTemplate(id: string, updates: UpdateTeamTemplateRequest): TeamTemplateDirectoryItem | undefined {
  ensureTemplatesTable();
  const row = getMainAgentTemplateRow(id);
  if (!row) return undefined;

  const existing = parseTeamTemplateRecord(parseTemplatePayload(row.content_skeleton));
  if (!existing) return undefined;

  const record = getValidatedTeamTemplateRecord(updates, existing);
  const db = getDb();
  const now = normalizeTimestamp();

  db.prepare(`
    UPDATE templates
    SET name = ?, content_skeleton = ?, system_prompt = ?, description = ?, updated_at = ?
    WHERE id = ?
  `).run(
    record.name,
    serializeTeamTemplateRecord(record),
    record.notes || '',
    record.summary,
    now,
    id,
  );

  return getTeamTemplateDirectoryItem(id);
}

export function deleteMainAgentTeamTemplate(id: string): boolean {
  ensureTemplatesTable();
  const db = getDb();
  return db.prepare('DELETE FROM templates WHERE id = ?').run(id).changes > 0;
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

export function getTasksBySession(
  sessionId: string,
  options: GetTasksBySessionOptions = {},
): TaskItem[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as TaskItem[];

  if (options.kind === TEAM_PLAN_TASK_KIND) {
    return rows.filter((task) => parseTeamPlanTaskRecord(task.description) !== null);
  }
  if (options.includeSystem) {
    return rows;
  }
  return rows.filter((task) => !isSystemTask(task));
}

export function getTask(id: string): TaskItem | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskItem | undefined;
}

export function ensureTeamRunExecution(taskId: string): void {
  const task = getTask(taskId);
  if (!task) {
    clearTeamRunAutomation(taskId);
    return;
  }

  const record = parseTeamPlanTaskRecord(task.description);
  if (!record || record.approvalStatus !== 'approved' || isTerminalTeamRunStatus(record.run.status)) {
    clearTeamRunAutomation(taskId);
    return;
  }

  scheduleTeamRunTick(taskId);
}

export function ensureSessionTeamRunsExecution(sessionId: string): void {
  const teamTasks = getTasksBySession(sessionId, { kind: TEAM_PLAN_TASK_KIND });
  for (const task of teamTasks) {
    ensureTeamRunExecution(task.id);
  }
}

export function ensureMainAgentTeamRunsExecution(): void {
  const sessions = getAllSessions().filter((session) => isMainAgentSession(session));
  for (const session of sessions) {
    ensureSessionTeamRunsExecution(session.id);
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
  const existing = getTask(id);
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

export function getLatestTeamPlanTask(sessionId: string): TaskItem | undefined {
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
      serializeTeamPlanTaskRecord(normalized),
    );
    return persistTeamPlanRecord(created.id, normalized) || created;
  }

  return persistTeamPlanRecord(existing.id, normalized) || existing;
}

export function updateTeamPlanApproval(
  taskId: string,
  approvalStatus: TeamPlanApprovalStatus,
): TaskItem | undefined {
  const task = getTask(taskId);
  if (!task) return undefined;

  const record = parseTeamPlanTaskRecord(task.description);
  if (!record) return undefined;

  const now = nowIso();
  const phases = unlockReadyPhases(record.run.phases);
  const nextRun = {
    ...record.run,
    phases,
    status: approvalStatus === 'approved' ? deriveRunStatus(phases) : 'blocked',
    createdAt: approvalStatus === 'approved' ? record.run.createdAt || now : record.run.createdAt || null,
    lastUpdatedAt: now,
    context: {
      ...record.run.context,
      ...(approvalStatus === 'approved'
        ? { blockedReason: undefined, lastError: undefined }
        : {}),
      ...(approvalStatus === 'rejected' ? { blockedReason: 'Team plan rejected by user.' } : {}),
    },
  };
  const nextRecord: TeamPlanTaskRecord = {
    ...record,
    approvalStatus,
    run: nextRun,
    lastActionAt: now,
    approvedAt: approvalStatus === 'approved' ? now : null,
    rejectedAt: approvalStatus === 'rejected' ? now : null,
  };

  const updated = persistTeamPlanRecord(taskId, nextRecord);
  if (updated && approvalStatus === 'approved') {
    ensureTeamRunExecution(taskId);
  }
  return updated;
}

export function updateTeamRunPhase(
  taskId: string,
  payload: {
    phaseId: string;
    phaseStatus?: TeamRunStatus;
    latestResult?: string;
  },
): TaskItem | undefined {
  const task = getTask(taskId);
  if (!task) return undefined;

  const record = parseTeamPlanTaskRecord(task.description);
  if (!record || record.approvalStatus !== 'approved') return undefined;

  const now = nowIso();
  let changed = false;
  let phases = record.run.phases.map((phase) => {
    if (phase.id !== payload.phaseId) return phase;
    changed = true;

    let nextStatus = payload.phaseStatus || phase.status;
    if ((nextStatus === 'running' || nextStatus === 'done') && !canActivatePhase(phase, record.run.phases)) {
      nextStatus = 'waiting';
    }

    return {
      ...phase,
      ...(payload.latestResult !== undefined ? { latestResult: payload.latestResult.trim() } : {}),
      status: nextStatus,
      updatedAt: now,
    };
  });

  if (!changed) return undefined;

  phases = unlockReadyPhases(phases);
  const status = deriveRunStatus(phases);
  const blockingPhase = phases.find((phase) => phase.status === 'blocked' && phase.latestResult?.trim());
  const failedPhase = phases.find((phase) => phase.status === 'failed' && phase.latestResult?.trim());
  const nextRun = applyAutomaticContextBackfill(record, {
    ...record.run,
    phases,
    status,
    startedAt: record.run.startedAt || (shouldMarkRunStarted(status) ? now : record.run.startedAt),
    completedAt: status === 'done' ? now : null,
    lastUpdatedAt: now,
    context: {
      ...record.run.context,
      blockedReason: status === 'blocked'
        ? blockingPhase?.latestResult?.trim() || record.run.context.blockedReason
        : undefined,
      lastError: status === 'failed'
        ? failedPhase?.latestResult?.trim() || record.run.context.lastError
        : undefined,
    },
  });

  const updated = persistTeamPlanRecord(taskId, {
    ...record,
    run: nextRun,
    lastActionAt: now,
  });
  if (updated && !isTerminalTeamRunStatus(nextRun.status)) {
    ensureTeamRunExecution(taskId);
  }
  return updated;
}

export function updateTeamRunContext(
  taskId: string,
  payload: {
    summary?: string;
    finalSummary?: string;
    blockedReason?: string;
    lastError?: string;
    publishSummary?: boolean;
  },
): TaskItem | undefined {
  const task = getTask(taskId);
  if (!task) return undefined;

  const record = parseTeamPlanTaskRecord(task.description);
  if (!record || record.approvalStatus !== 'approved') return undefined;

  const now = nowIso();
  const nextContext: TeamRunContext = {
    ...record.run.context,
    ...(payload.summary !== undefined
      ? {
          summary: payload.summary.trim(),
          summarySource: payload.summary.trim() ? 'manual' : 'auto',
        }
      : {}),
    ...(payload.finalSummary !== undefined
      ? {
          finalSummary: payload.finalSummary.trim(),
          finalSummarySource: payload.finalSummary.trim() ? 'manual' : 'auto',
        }
      : {}),
    ...(payload.blockedReason !== undefined
      ? { blockedReason: payload.blockedReason.trim() || undefined }
      : {}),
    ...(payload.lastError !== undefined
      ? { lastError: payload.lastError.trim() || undefined }
      : {}),
    ...(payload.publishSummary ? { publishedAt: now } : {}),
  };

  let nextStatus = record.run.status;
  if (payload.lastError !== undefined && payload.lastError.trim()) {
    nextStatus = 'failed';
  } else if (payload.blockedReason !== undefined && payload.blockedReason.trim()) {
    nextStatus = 'blocked';
  } else if (record.run.phases.length > 0) {
    nextStatus = deriveRunStatus(record.run.phases);
  }

  const nextRun = applyAutomaticContextBackfill(record, {
    ...record.run,
    status: nextStatus,
    context: nextContext,
    lastUpdatedAt: now,
    completedAt: nextStatus === 'done' ? now : null,
  });

  const updated = persistTeamPlanRecord(taskId, {
    ...record,
    run: nextRun,
    lastActionAt: now,
  });
  if (updated && !isTerminalTeamRunStatus(nextRun.status)) {
    ensureTeamRunExecution(taskId);
  }
  return updated;
}

export function resumeTeamRun(taskId: string): TaskItem | undefined {
  const task = getTask(taskId);
  if (!task) return undefined;

  const record = parseTeamPlanTaskRecord(task.description);
  if (!record || record.approvalStatus !== 'approved') return undefined;

  const now = nowIso();
  const phases = unlockReadyPhases(record.run.phases.map((phase) => {
    if (phase.status === 'waiting' && canActivatePhase(phase, record.run.phases)) {
      return { ...phase, status: 'ready', updatedAt: now };
    }
    return phase;
  }));
  const status = deriveRunStatus(phases);
  const nextRun = applyAutomaticContextBackfill(record, {
    ...record.run,
    phases,
    status,
    resumeCount: record.run.resumeCount + 1,
    lastUpdatedAt: now,
    completedAt: status === 'done' ? record.run.completedAt : null,
    context: {
      ...record.run.context,
      blockedReason: status === 'blocked' ? record.run.context.blockedReason : undefined,
    },
  });

  const updated = persistTeamPlanRecord(taskId, {
    ...record,
    run: nextRun,
    lastActionAt: now,
  });
  if (updated) {
    ensureTeamRunExecution(taskId);
  }
  return updated;
}
