import { isMainAgentSession } from '@/lib/chat/session-entry';
import { getDb } from '@/lib/db/connection';
import {
  getTask,
  getTasksBySession,
  listMainAgentAgentPresets,
  listMainAgentTeamTemplates,
} from '@/lib/db/tasks';
import { getAllSessions, getSession } from '@/lib/db/sessions';
import { parseCompiledRunPlan } from './compiler';
import { getRuntimeArtifactPreviewKind } from './runtime-artifact-preview';
import type {
  ChatSession,
  MainAgentCatalogResponse,
  StageArtifactProjectionV1,
  TaskArtifactItem,
  TaskDetailProjectionV1,
  TaskDirectoryItem,
  TaskDirectorySource,
  TaskItem,
  TaskStatus,
  TeamBannerHistoryItemV1,
  TeamBannerProjectionV1,
  TeamDirectoryItem,
  TeamPlanTaskRecord,
  TeamRoleDirectoryItem,
  TeamRoleProjectionV1,
  TeamRunDetailProjectionV1,
  TeamRunStatus,
  TeamStageProjectionV1,
  TeamWorkspaceProjectionV1,
} from '@/types';
import { parseTeamPlanTaskRecord } from '@/types';

interface TeamRunRow {
  id: string;
  task_id: string | null;
  published_at: string | null;
  projection_version: number;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  compiled_plan_json: string;
}

interface TeamRunStageRow {
  id: string;
  run_id: string;
  name: string;
  role_id: string;
  plan_task_id: string;
  owner_agent_type: string;
  status: string;
  dependencies: string;
  latest_result: string | null;
  latest_result_ref: string | null;
  retry_count: number;
  updated_at: number;
}

interface TeamRunArtifactRow {
  id: string;
  run_id: string;
  stage_id: string;
  type: 'output' | 'file' | 'log' | 'metadata';
  title: string;
  source_path: string | null;
  content_type: string;
  size: number;
  created_at: number;
}

function buildTaskPath(taskId: string): string {
  return `/tasks/${taskId}`;
}

function buildTeamPath(teamId: string): string {
  return `/team/${teamId}`;
}

function toIsoFromEpoch(value: number | null | undefined): string | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).toISOString()
    : undefined;
}

function parseDependencies(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function getRunRow(runId: string): TeamRunRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM team_runs WHERE id = ?').get(runId) as TeamRunRow | undefined;
}

function getRunStageRows(runId: string): TeamRunStageRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM team_run_stages WHERE run_id = ? ORDER BY created_at ASC, id ASC').all(runId) as TeamRunStageRow[];
}

function getRunArtifactRows(runId: string): TeamRunArtifactRow[] {
  const db = getDb();
  return db.prepare(`
    SELECT id, run_id, stage_id, type, title, source_path, content_type, size, created_at
    FROM team_run_artifacts
    WHERE run_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(runId) as TeamRunArtifactRow[];
}

function getTaskByRunId(runId: string): TaskItem | undefined {
  const db = getDb();
  const row = db.prepare('SELECT id FROM tasks WHERE current_run_id = ? LIMIT 1').get(runId) as { id: string } | undefined;
  return row ? getTask(row.id) : undefined;
}

function getCurrentTeamPhase(record: TeamPlanTaskRecord) {
  return record.run.phases.find((phase) => ['running', 'blocked', 'waiting', 'ready'].includes(phase.status))
    || record.run.phases.find((phase) => phase.status === 'done');
}

function summarizeTeamExecutors(record: TeamPlanTaskRecord): string {
  const roleNames = record.plan.roles
    .filter((role) => role.kind !== 'main_agent')
    .map((role) => role.name);

  if (roleNames.length === 0) return '主代理';
  if (roleNames.length === 1) return roleNames[0];
  if (roleNames.length === 2) return roleNames.join(' / ');
  return `${roleNames[0]} / ${roleNames[1]} / +${roleNames.length - 2}`;
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

function buildStageArtifactProjection(
  artifact: TeamRunArtifactRow,
  stageTitle?: string,
): StageArtifactProjectionV1 {
  const previewKind = getRuntimeArtifactPreviewKind({
    contentType: artifact.content_type,
    size: artifact.size,
    ...(artifact.source_path ? { sourcePath: artifact.source_path } : {}),
  });

  return {
    artifactId: artifact.id,
    title: artifact.title || artifact.source_path || artifact.id,
    type: artifact.type,
    contentType: artifact.content_type,
    size: artifact.size,
    previewable: Boolean(previewKind),
    ...(previewKind ? { previewKind } : {}),
    stageId: artifact.stage_id,
    ...(stageTitle ? { stageTitle } : {}),
    ...(artifact.source_path ? { sourcePath: artifact.source_path } : {}),
  };
}

function buildRuntimeArtifactCollections(
  runId?: string | null,
  stageTitleById?: Map<string, string>,
): {
  all: StageArtifactProjectionV1[];
  byStageId: Map<string, StageArtifactProjectionV1[]>;
} {
  if (!runId) {
    return {
      all: [],
      byStageId: new Map(),
    };
  }

  const all: StageArtifactProjectionV1[] = [];
  const byStageId = new Map<string, StageArtifactProjectionV1[]>();

  for (const artifact of getRunArtifactRows(runId)) {
    const projection = buildStageArtifactProjection(artifact, stageTitleById?.get(artifact.stage_id));
    all.push(projection);
    const existing = byStageId.get(artifact.stage_id) || [];
    existing.push(projection);
    byStageId.set(artifact.stage_id, existing);
  }

  return { all, byStageId };
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

function buildWorkspaceProjection(task: TaskItem, record: TeamPlanTaskRecord): TeamWorkspaceProjectionV1 {
  return {
    projectionVersion: 1,
    taskId: task.id,
    ...(task.current_run_id ? { runId: task.current_run_id } : {}),
    approvalStatus: record.approvalStatus,
    plan: record.plan,
    run: record.run,
  };
}

function buildManualTaskCatalogItem(session: ChatSession, task: TaskItem): TaskDirectoryItem {
  const outputs = task.status === 'completed' && task.description?.trim() ? [task.description.trim()] : [];
  return {
    id: task.id,
    source: 'manual',
    sessionId: session.id,
    sessionTitle: session.title,
    workingDirectory: session.working_directory,
    projectName: session.project_name,
    title: task.title,
    summary: task.description?.trim() || '',
    status: task.status,
    updatedAt: task.updated_at,
    executionMode: 'main_agent',
    createdScenario: session.title || task.title,
    executorLabel: '主代理',
    progressCompleted: task.status === 'completed' ? 1 : 0,
    progressTotal: 1,
    outputs,
    artifacts: [],
    taskPath: buildTaskPath(task.id),
    dependsOn: [],
  };
}

function buildTeamTaskCatalogItem(session: ChatSession, task: TaskItem, record: TeamPlanTaskRecord): TaskDirectoryItem {
  const currentPhase = getCurrentTeamPhase(record);
  const outputs = buildTeamOutputs(record);
  const currentExecutorName = currentPhase
    ? record.plan.roles.find((role) => role.id === currentPhase.ownerRoleId)?.name
    : undefined;

  return {
    id: task.id,
    ...(task.current_run_id ? { runId: task.current_run_id } : {}),
    source: 'team',
    sessionId: session.id,
    sessionTitle: session.title,
    workingDirectory: session.working_directory,
    projectName: session.project_name,
    title: record.plan.summary,
    summary: record.plan.expectedOutcome,
    status: record.run.status,
    updatedAt: task.updated_at,
    executionMode: 'team_mode',
    createdScenario: record.plan.userGoal,
    executorLabel: summarizeTeamExecutors(record),
    progressCompleted: record.run.phases.filter((phase) => phase.status === 'done').length,
    progressTotal: record.plan.tasks.length,
    outputs,
    artifacts: buildTeamArtifacts(record, task),
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
  };
}

function buildTeamCatalogItem(session: ChatSession, task: TaskItem, record: TeamPlanTaskRecord): TeamDirectoryItem {
  const currentPhase = getCurrentTeamPhase(record);
  const outputs = buildTeamOutputs(record);
  const currentExecutorName = currentPhase
    ? record.plan.roles.find((role) => role.id === currentPhase.ownerRoleId)?.name
    : undefined;

  return {
    id: task.id,
    ...(task.current_run_id ? { runId: task.current_run_id } : {}),
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
    roleCount: record.plan.roles.filter((role) => role.kind !== 'main_agent').length,
    taskCount: record.plan.tasks.length,
    completedTaskCount: record.run.phases.filter((phase) => phase.status === 'done').length,
    updatedAt: task.updated_at,
    relatedTaskId: task.id,
    relatedTaskPath: buildTaskPath(task.id),
    teamPath: buildTeamPath(task.id),
    executorLabel: summarizeTeamExecutors(record),
    createdScenario: record.plan.userGoal,
    roles: buildTeamRoles(record),
    outputs,
    artifacts: buildTeamArtifacts(record, task),
    ...(currentPhase ? { currentStage: currentPhase.title } : {}),
    ...(currentExecutorName ? { currentExecutorName } : {}),
    ...(outputs[0] ? { latestOutput: outputs[0] } : {}),
    ...(record.run.context.blockedReason ? { blockedReason: record.run.context.blockedReason } : {}),
    ...(record.run.context.finalSummary?.trim() ? { finalSummary: record.run.context.finalSummary.trim() } : {}),
  };
}

function buildTaskDetailProjection(session: ChatSession, task: TaskItem, record?: TeamPlanTaskRecord | null): TaskDetailProjectionV1 {
  if (!record) {
    return {
      projectionVersion: 1,
      taskId: task.id,
      source: 'manual',
      sessionId: session.id,
      sessionTitle: session.title,
      workingDirectory: session.working_directory,
      projectName: session.project_name,
      title: task.title,
      summary: task.description?.trim() || '',
      businessStatus: task.status,
      executionMode: 'main_agent',
      createdScenario: session.title || task.title,
      executorLabel: '主代理',
      progressCompleted: task.status === 'completed' ? 1 : 0,
      progressTotal: 1,
      outputs: task.status === 'completed' && task.description?.trim() ? [task.description.trim()] : [],
      artifacts: [],
      runtimeArtifacts: [],
      taskPath: buildTaskPath(task.id),
      updatedAt: task.updated_at,
    };
  }

  const currentPhase = getCurrentTeamPhase(record);
  const outputs = buildTeamOutputs(record);
  const stageTitleById = new Map(record.run.phases.map((phase) => [phase.id, phase.title]));
  const runtimeArtifacts = buildRuntimeArtifactCollections(task.current_run_id, stageTitleById).all;
  const currentExecutorName = currentPhase
    ? record.plan.roles.find((role) => role.id === currentPhase.ownerRoleId)?.name
    : undefined;

  return {
    projectionVersion: 1,
    taskId: task.id,
    ...(task.current_run_id ? { runId: task.current_run_id } : {}),
    source: 'team',
    sessionId: session.id,
    sessionTitle: session.title,
    workingDirectory: session.working_directory,
    projectName: session.project_name,
    title: record.plan.summary,
    summary: record.plan.expectedOutcome,
    businessStatus: task.status,
    runStatus: record.run.status,
    executionMode: 'team_mode',
    createdScenario: record.plan.userGoal,
    executorLabel: summarizeTeamExecutors(record),
    progressCompleted: record.run.phases.filter((phase) => phase.status === 'done').length,
    progressTotal: record.plan.tasks.length,
    outputs,
    artifacts: buildTeamArtifacts(record, task),
    runtimeArtifacts,
    taskPath: buildTaskPath(task.id),
    teamPath: buildTeamPath(task.id),
    ...(currentPhase ? { currentStage: currentPhase.title } : {}),
    ...(currentExecutorName ? { currentExecutorName } : {}),
    ...(outputs[0] ? { latestOutput: outputs[0] } : {}),
    ...(record.plan.userGoal ? { userGoal: record.plan.userGoal } : {}),
    approvalStatus: record.approvalStatus,
    expectedOutcome: record.plan.expectedOutcome,
    ...(record.run.context.finalSummary?.trim() ? { finalSummary: record.run.context.finalSummary.trim() } : {}),
    updatedAt: task.updated_at,
  };
}

function computeRunProjectionVersion(
  run: TeamRunRow | undefined,
  stages: TeamRunStageRow[],
  artifacts: TeamRunArtifactRow[] = [],
): number {
  const stageVersion = stages.reduce((max, stage) => Math.max(max, stage.updated_at || 0), 0);
  const artifactVersion = artifacts.reduce((max, artifact) => Math.max(max, artifact.created_at || 0), 0);
  return Math.max(
    run?.projection_version || 0,
    run?.created_at || 0,
    run?.started_at || 0,
    run?.completed_at || 0,
    stageVersion,
    artifactVersion,
  );
}

function buildTeamRunDetailProjectionFromTask(task: TaskItem, record: TeamPlanTaskRecord, runId: string): TeamRunDetailProjectionV1 | null {
  const run = getRunRow(runId);
  if (!run) return null;

  const stages = getRunStageRows(runId);
  const compiledPlan = parseCompiledRunPlan(run.compiled_plan_json);
  const runtimeRoleMap = new Map(compiledPlan?.roles.map((role) => [role.roleId, role]) || []);
  const runtimeStageMap = new Map(compiledPlan?.stages.map((stage) => [stage.stageId, stage]) || []);
  const phaseByStageId = new Map(record.run.phases.map((phase) => [phase.id, phase]));
  const externalRoleMap = new Map(record.plan.roles.map((role) => [role.id, role]));
  const currentPhase = getCurrentTeamPhase(record);
  const currentExecutorName = currentPhase
    ? externalRoleMap.get(currentPhase.ownerRoleId)?.name
    : undefined;
  const stageTitleById = new Map<string, string>();

  for (const stage of stages) {
    const phase = phaseByStageId.get(stage.id);
    const compiledStage = runtimeStageMap.get(stage.id);
    stageTitleById.set(stage.id, stage.name || compiledStage?.title || phase?.title || stage.id);
  }
  for (const phase of record.run.phases) {
    if (!stageTitleById.has(phase.id)) {
      stageTitleById.set(phase.id, phase.title);
    }
  }

  const runtimeArtifactRows = getRunArtifactRows(runId);
  const runtimeArtifactCollections = (() => {
    const all: StageArtifactProjectionV1[] = [];
    const byStageId = new Map<string, StageArtifactProjectionV1[]>();

    for (const artifact of runtimeArtifactRows) {
      const projection = buildStageArtifactProjection(artifact, stageTitleById.get(artifact.stage_id));
      all.push(projection);
      const existing = byStageId.get(artifact.stage_id) || [];
      existing.push(projection);
      byStageId.set(artifact.stage_id, existing);
    }

    return { all, byStageId };
  })();

  const roleProjections: TeamRoleProjectionV1[] = compiledPlan?.roles?.length
    ? compiledPlan.roles.map((role) => ({
        roleId: role.roleId,
        externalRoleId: role.externalRoleId,
        name: role.name,
        roleKind: role.roleKind,
        responsibility: role.responsibility,
        ...(role.parentRoleId ? { parentRoleId: role.parentRoleId } : {}),
      }))
    : record.plan.roles.map((role) => ({
        roleId: role.id,
        externalRoleId: role.id,
        name: role.name,
        roleKind: role.kind,
        responsibility: role.responsibility,
        ...(role.parentRoleId ? { parentRoleId: role.parentRoleId } : {}),
      }));

  const stageProjections: TeamStageProjectionV1[] = stages.length > 0
    ? stages.map((stage) => {
        const phase = phaseByStageId.get(stage.id);
        const compiledStage = runtimeStageMap.get(stage.id);
        return {
          stageId: stage.id,
          planTaskId: stage.plan_task_id || compiledStage?.externalTaskId || phase?.planTaskId || stage.id,
          title: stage.name || compiledStage?.title || phase?.title || stage.id,
          status: (phase?.status || stage.status) as TeamRunStatus,
          ownerRoleId: stage.role_id,
          ownerAgentType: stage.owner_agent_type || compiledStage?.ownerAgentType || runtimeRoleMap.get(stage.role_id)?.agentType || '',
          expectedOutput: phase?.expectedOutput || compiledStage?.expectedOutput || '',
          dependsOnStageIds: parseDependencies(stage.dependencies),
          ...(phase?.latestResult || stage.latest_result
            ? { latestResultSummary: phase?.latestResult || stage.latest_result || undefined }
            : {}),
          ...(stage.latest_result_ref ? { latestResultRef: stage.latest_result_ref } : {}),
          artifacts: runtimeArtifactCollections.byStageId.get(stage.id) || [],
          retryCount: stage.retry_count || 0,
          ...(toIsoFromEpoch(stage.updated_at) ? { updatedAt: toIsoFromEpoch(stage.updated_at) } : {}),
        };
      })
    : record.run.phases.map((phase) => {
        const compiledStage = runtimeStageMap.get(phase.id);
        return {
          stageId: phase.id,
          planTaskId: phase.planTaskId,
          title: phase.title,
          status: phase.status,
          ownerRoleId: compiledStage?.ownerRoleId || phase.ownerRoleId,
          ownerAgentType: compiledStage?.ownerAgentType || '',
          expectedOutput: phase.expectedOutput,
          dependsOnStageIds: compiledStage?.dependsOnStageIds || phase.dependsOn,
          ...(phase.latestResult ? { latestResultSummary: phase.latestResult } : {}),
          artifacts: runtimeArtifactCollections.byStageId.get(phase.id) || [],
          retryCount: 0,
          ...(phase.updatedAt ? { updatedAt: phase.updatedAt } : {}),
        };
      });

  return {
    projectionVersion: computeRunProjectionVersion(run, stages, runtimeArtifactRows),
    taskId: task.id,
    runId,
    title: record.plan.summary,
    summary: record.plan.summary,
    userGoal: record.plan.userGoal,
    expectedOutcome: record.plan.expectedOutcome,
    approvalStatus: record.approvalStatus,
    runStatus: record.run.status,
    budget: record.run.budget,
    lifecycle: {
      ...(record.run.createdAt ? { createdAt: record.run.createdAt } : {}),
      ...(record.run.startedAt ? { startedAt: record.run.startedAt } : {}),
      ...(record.run.completedAt ? { completedAt: record.run.completedAt } : {}),
      ...(run.published_at ? { publishedAt: run.published_at } : {}),
    },
    guardrails: {
      hierarchy: record.run.hierarchy,
      maxDepth: record.run.maxDepth,
      lockScope: record.run.lockScope,
      resumeCount: record.run.resumeCount,
    },
    roles: roleProjections,
    stages: stageProjections,
    context: {
      summary: record.run.context.summary,
      finalSummary: record.run.context.finalSummary,
      summarySource: record.run.context.summarySource || 'auto',
      finalSummarySource: record.run.context.finalSummarySource || 'auto',
      ...(record.run.context.blockedReason ? { blockedReason: record.run.context.blockedReason } : {}),
      ...(record.run.context.lastError ? { lastError: record.run.context.lastError } : {}),
    },
    outputs: buildTeamOutputs(record),
    artifacts: buildTeamArtifacts(record, task),
    runtimeArtifacts: runtimeArtifactCollections.all,
    taskPath: buildTaskPath(task.id),
    teamPath: buildTeamPath(task.id),
    ...(currentPhase ? { currentStage: currentPhase.title } : {}),
    ...(currentExecutorName ? { currentExecutorName } : {}),
  };
}

function buildBannerHistoryItem(task: TaskItem, record: TeamPlanTaskRecord): TeamBannerHistoryItemV1 {
  const currentPhase = getCurrentTeamPhase(record);
  const currentExecutorName = currentPhase
    ? record.plan.roles.find((role) => role.id === currentPhase.ownerRoleId)?.name
    : undefined;

  return {
    taskId: task.id,
    ...(task.current_run_id ? { runId: task.current_run_id } : {}),
    title: record.plan.summary,
    approvalStatus: record.approvalStatus,
    runStatus: record.run.status,
    ...(currentPhase ? { currentStageTitle: currentPhase.title } : {}),
    ...(currentExecutorName ? { currentExecutorName } : {}),
    taskPath: buildTaskPath(task.id),
    teamPath: buildTeamPath(task.id),
  };
}

export function getMainAgentCatalogProjection(): MainAgentCatalogResponse {
  const sessions = getAllSessions().filter((session) => isMainAgentSession(session));
  const teams: TeamDirectoryItem[] = [];
  const tasks: TaskDirectoryItem[] = [];

  for (const session of sessions) {
    const sessionTasks = getTasksBySession(session.id, { includeSystem: true });
    for (const task of sessionTasks) {
      const record = parseTeamPlanTaskRecord(task.description);
      if (record) {
        teams.push(buildTeamCatalogItem(session, task, record));
        tasks.push(buildTeamTaskCatalogItem(session, task, record));
        continue;
      }

      tasks.push(buildManualTaskCatalogItem(session, task));
    }
  }

  teams.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  tasks.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return {
    teams,
    tasks,
    agentPresets: listMainAgentAgentPresets(),
    teamTemplates: listMainAgentTeamTemplates(),
  };
}

export function getTaskCatalogItemProjection(taskId: string): TaskDirectoryItem | undefined {
  return getMainAgentCatalogProjection().tasks.find((task) => task.id === taskId);
}

export function getTeamCatalogItemProjection(teamId: string): TeamDirectoryItem | undefined {
  return getMainAgentCatalogProjection().teams.find((team) => team.id === teamId);
}

export function getTaskViewProjection(taskId: string): {
  task: TaskDetailProjectionV1;
  workspace?: TeamWorkspaceProjectionV1;
} | undefined {
  const task = getTask(taskId);
  if (!task) return undefined;

  const session = getSession(task.session_id);
  if (!session) return undefined;

  const record = parseTeamPlanTaskRecord(task.description);
  if (!record) {
    return {
      task: buildTaskDetailProjection(session, task),
    };
  }

  return {
    task: buildTaskDetailProjection(session, task, record),
    workspace: buildWorkspaceProjection(task, record),
  };
}

export function getTaskDetailProjection(taskId: string): TaskDetailProjectionV1 | undefined {
  return getTaskViewProjection(taskId)?.task;
}

export function getSessionTeamBannerProjection(sessionId: string): TeamBannerProjectionV1 | null {
  if (!getSession(sessionId)) return null;

  const teamTasks = getTasksBySession(sessionId, { includeSystem: true })
    .map((task) => {
      const record = parseTeamPlanTaskRecord(task.description);
      return record ? { task, record } : null;
    })
    .filter((item): item is { task: TaskItem; record: TeamPlanTaskRecord } => Boolean(item));

  if (teamTasks.length === 0) return null;

  const latest = teamTasks[teamTasks.length - 1];
  const currentPhase = getCurrentTeamPhase(latest.record);
  const currentExecutorName = currentPhase
    ? latest.record.plan.roles.find((role) => role.id === currentPhase.ownerRoleId)?.name
    : undefined;
  const recent = teamTasks.slice(-3).reverse().map(({ task, record }) => buildBannerHistoryItem(task, record));
  const run = latest.task.current_run_id ? getRunRow(latest.task.current_run_id) : undefined;
  const stages = latest.task.current_run_id ? getRunStageRows(latest.task.current_run_id) : [];
  const runtimeArtifacts = latest.task.current_run_id ? getRunArtifactRows(latest.task.current_run_id) : [];

  return {
    projectionVersion: computeRunProjectionVersion(run, stages, runtimeArtifacts) || Date.parse(latest.task.updated_at) || 1,
    sessionId,
    taskId: latest.task.id,
    ...(latest.task.current_run_id ? { runId: latest.task.current_run_id } : {}),
    approvalStatus: latest.record.approvalStatus,
    runStatus: latest.record.run.status,
    title: latest.record.plan.summary,
    summary: latest.record.plan.expectedOutcome,
    completedStageCount: latest.record.run.phases.filter((phase) => phase.status === 'done').length,
    totalStageCount: latest.record.plan.tasks.length,
    ...(currentPhase ? { currentStageTitle: currentPhase.title } : {}),
    ...(currentExecutorName ? { currentExecutorName } : {}),
    taskPath: buildTaskPath(latest.task.id),
    teamPath: buildTeamPath(latest.task.id),
    historyCount: teamTasks.length,
    recent,
    workspace: buildWorkspaceProjection(latest.task, latest.record),
  };
}

export function getTeamRunDetailProjection(runId: string): TeamRunDetailProjectionV1 | undefined {
  const task = getTaskByRunId(runId);
  if (!task) return undefined;

  const record = parseTeamPlanTaskRecord(task.description);
  if (!record) return undefined;

  return buildTeamRunDetailProjectionFromTask(task, record, runId) || undefined;
}
