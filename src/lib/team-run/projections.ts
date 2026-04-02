import { getDb } from '@/lib/db/connection';
import { getTasksBySession } from '@/lib/db/tasks';
import { getSession } from '@/lib/db/sessions';
import type {
  TaskItem,
  TeamBannerHistoryItemV1,
  TeamBannerProjectionV1,
  TeamPlanTaskRecord,
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

function getCurrentTeamPhase(record: TeamPlanTaskRecord) {
  return record.run.phases.find((phase) => ['running', 'blocked', 'waiting', 'ready'].includes(phase.status))
    || record.run.phases.find((phase) => phase.status === 'done');
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
