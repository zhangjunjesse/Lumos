'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  TaskDetailProjectionResponseV1,
  TaskDetailProjectionV1,
  TeamPlanApprovalStatus,
  TeamPlanRoleKind,
  TeamRunDetailProjectionResponseV1,
  TeamRunDetailProjectionV1,
  TeamRunStatus,
  TeamWorkspaceProjectionV1,
} from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RuntimeArtifactActions } from '@/components/conversations/runtime-artifact-actions';
import { cn } from '@/lib/utils';
import { useTeamRunStream } from '@/hooks/useTeamRunStream';

interface TeamRunDetailViewProps {
  taskId: string;
  initialTask: TaskDetailProjectionV1;
  initialWorkspace: TeamWorkspaceProjectionV1;
  initialTeam: TeamRunDetailProjectionV1 | null;
}

const TEAM_RUN_STATUS_CLASSNAME: Record<TeamRunStatus, string> = {
  pending: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  ready: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  running: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  waiting: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  blocked: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  paused: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  cancelling: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  cancelled: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  summarizing: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
  done: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  failed: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
};

const TEAM_APPROVAL_CLASSNAME: Record<TeamPlanApprovalStatus, string> = {
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  rejected: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

const TEAM_RUN_STATUS_LABEL_KEY = {
  pending: 'team.status.pending',
  ready: 'team.status.ready',
  running: 'team.status.running',
  waiting: 'team.status.waiting',
  blocked: 'team.status.blocked',
  paused: 'team.status.paused',
  cancelling: 'team.status.cancelling',
  cancelled: 'team.status.cancelled',
  summarizing: 'team.status.summarizing',
  done: 'team.status.done',
  failed: 'team.status.failed',
} as const;

const ACTIVE_STREAM_STATUSES: TeamRunStatus[] = ['pending', 'ready', 'running', 'waiting', 'cancelling', 'summarizing'];

function formatTimestamp(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function RoleKindBadge({ kind }: { kind: TeamPlanRoleKind }) {
  const { t } = useTranslation();
  const key = {
    main_agent: 'team.role.mainAgent',
    orchestrator: 'team.role.orchestrator',
    lead: 'team.role.lead',
    worker: 'team.role.worker',
  } as const;

  return (
    <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.14em]">
      {t(key[kind])}
    </Badge>
  );
}

export function TeamRunDetailView({
  taskId,
  initialTask,
  initialWorkspace,
  initialTeam,
}: TeamRunDetailViewProps) {
  const { t } = useTranslation();
  const [taskState, setTaskState] = useState(initialTask);
  const [workspaceState, setWorkspaceState] = useState(initialWorkspace);
  const [teamState, setTeamState] = useState<TeamRunDetailProjectionV1 | null>(initialTeam);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [error, setError] = useState('');

  const activeRunId = teamState?.runId || workspaceState.runId || null;
  const activeRunStatus = teamState?.runStatus || workspaceState.run.status;
  const canStream = Boolean(activeRunId) && ACTIVE_STREAM_STATUSES.includes(activeRunStatus);
  const { status: sseStatus, stages: sseStages, isConnected } = useTeamRunStream(canStream ? activeRunId : null);
  const sseStageSignature = useMemo(
    () => sseStages.map((stage) => `${stage.stageId}:${stage.status}:${stage.latestResultSummary || ''}`).join('|'),
    [sseStages],
  );

  const loadLatest = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setError('');
    }

    const taskResponse = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/view`, { cache: 'no-store' });
    const taskData: Partial<TaskDetailProjectionResponseV1> & { error?: string } = await taskResponse.json().catch(() => ({}));
    if (!taskResponse.ok || !taskData.task || !taskData.workspace) {
      throw new Error(taskData.error || 'Failed to load team task');
    }

    setTaskState(taskData.task);
    setWorkspaceState(taskData.workspace);

    if (!taskData.workspace.runId) {
      setTeamState(null);
      return;
    }

    const teamResponse = await fetch(`/api/team-runs/${encodeURIComponent(taskData.workspace.runId)}/view`, { cache: 'no-store' });
    const teamData: Partial<TeamRunDetailProjectionResponseV1> & { error?: string } = await teamResponse.json().catch(() => ({}));
    if (!teamResponse.ok || !teamData.team) {
      throw new Error(teamData.error || 'Failed to load team run');
    }

    setTeamState(teamData.team);
  }, [taskId]);

  useEffect(() => {
    setTaskState(initialTask);
    setWorkspaceState(initialWorkspace);
    setTeamState(initialTeam);
  }, [initialTask, initialWorkspace, initialTeam]);

  useEffect(() => {
    if (!canStream || !isConnected) return;
    if (!sseStatus && !sseStageSignature) return;

    void loadLatest({ silent: true }).catch(() => {
      // Best effort only.
    });
  }, [canStream, isConnected, loadLatest, sseStageSignature, sseStatus]);

  const shouldPoll = !isConnected && (
    ACTIVE_STREAM_STATUSES.includes(activeRunStatus)
    || workspaceState.approvalStatus === 'pending'
  );

  useEffect(() => {
    if (!shouldPoll) return undefined;

    const interval = window.setInterval(() => {
      void loadLatest({ silent: true }).catch(() => {
        // Best effort only.
      });
    }, 2000);

    return () => window.clearInterval(interval);
  }, [loadLatest, shouldPoll]);

  const approvalStatus = teamState?.approvalStatus || workspaceState.approvalStatus;
  const runStatus = teamState?.runStatus || workspaceState.run.status;
  const runStatusLabel = useMemo(() => t(TEAM_RUN_STATUS_LABEL_KEY[runStatus]), [runStatus, t]);
  const approvalStatusLabel = useMemo(() => {
    const key = {
      pending: 'team.approval.pending',
      approved: 'team.approval.approved',
      rejected: 'team.approval.rejected',
    } as const;
    return t(key[approvalStatus]);
  }, [approvalStatus, t]);

  const fallbackRoleMap = useMemo(
    () => new Map(workspaceState.plan.roles.map((role) => [role.id, role])),
    [workspaceState.plan.roles],
  );
  const runRoleMap = useMemo(
    () => new Map(teamState?.roles.map((role) => [role.roleId, role]) || []),
    [teamState?.roles],
  );

  const roles = useMemo(() => {
    if (teamState) {
      return teamState.roles.map((role) => ({
        id: role.roleId,
        name: role.name,
        kind: role.roleKind,
        responsibility: role.responsibility,
      }));
    }

    return workspaceState.plan.roles
      .filter((role) => role.kind !== 'main_agent')
      .map((role) => ({
        id: role.id,
        name: role.name,
        kind: role.kind,
        responsibility: role.responsibility,
      }));
  }, [teamState, workspaceState.plan.roles]);

  const stageCards = useMemo(() => {
    if (teamState) {
      return teamState.stages.map((stage) => ({
        id: stage.stageId,
        title: stage.title,
        status: stage.status,
        ownerName: runRoleMap.get(stage.ownerRoleId)?.name || fallbackRoleMap.get(stage.ownerRoleId)?.name,
        summary: stage.latestResultSummary || '',
        expectedOutput: stage.expectedOutput,
      }));
    }

    return workspaceState.run.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      status: phase.status,
      ownerName: fallbackRoleMap.get(phase.ownerRoleId)?.name,
      summary: phase.latestResult || '',
      expectedOutput: phase.expectedOutput,
    }));
  }, [fallbackRoleMap, runRoleMap, teamState, workspaceState.run.phases]);

  const completedCount = teamState
    ? teamState.stages.filter((stage) => stage.status === 'done').length
    : workspaceState.run.phases.filter((phase) => phase.status === 'done').length;
  const totalCount = teamState ? teamState.stages.length : workspaceState.run.phases.length;
  const currentStage = teamState?.currentStage || taskState.currentStage;
  const currentExecutorName = teamState?.currentExecutorName || taskState.currentExecutorName;
  const outputs = teamState?.outputs || taskState.outputs;
  const runtimeArtifacts = teamState?.runtimeArtifacts || [];
  const finalSummary = teamState?.context.finalSummary || workspaceState.run.context.finalSummary || taskState.finalSummary || '';
  const blockedReason = teamState?.context.blockedReason || workspaceState.run.context.blockedReason;
  const lastError = teamState?.context.lastError || workspaceState.run.context.lastError;
  const lifecycle = teamState
    ? teamState.lifecycle
    : {
        createdAt: workspaceState.run.createdAt || undefined,
        startedAt: workspaceState.run.startedAt || undefined,
        completedAt: workspaceState.run.completedAt || undefined,
        publishedAt: workspaceState.run.context.publishedAt || undefined,
      };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{teamState?.title || taskState.title}</h1>
            <Badge className={cn('border font-medium', TEAM_APPROVAL_CLASSNAME[approvalStatus])}>
              {approvalStatusLabel}
            </Badge>
            <Badge className={cn('border font-medium', TEAM_RUN_STATUS_CLASSNAME[runStatus])}>
              {runStatusLabel}
            </Badge>
          </div>
          <p className="max-w-4xl text-sm text-muted-foreground">{teamState?.summary || taskState.summary}</p>
          <p className="text-sm text-muted-foreground">
            {t('teamDetail.handoff', {
              executor: currentExecutorName || t('teamHub.currentStageNone'),
            })}
          </p>
          {error ? (
            <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/team">{t('teamDetail.backToTeams')}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={taskState.taskPath}>{t('teamDetail.openTask')}</Link>
          </Button>
          <Button asChild>
            <Link href={`/main-agent/${taskState.sessionId}`}>{t('teamHub.openSession')}</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('teamDetail.scope')}</CardTitle>
          <CardDescription>{t('teamDetail.scopeHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{t('teamDetail.createdScenario')}: {taskState.createdScenario}</p>
            <p>{t('teamDetail.linkedTask')}: {taskState.title}</p>
            <p>{t('teamDetail.currentStage')}: {currentStage || t('teamHub.currentStageNone')}</p>
            <p>{t('teamDetail.currentExecutor')}: {currentExecutorName || t('teamHub.currentStageNone')}</p>
            <p>{t('teamDetail.progress')}: {completedCount}/{totalCount}</p>
            <p>{t('teamDetail.updatedAt')}: {formatTimestamp(taskState.updatedAt)}</p>
            {taskState.projectName ? <p>{t('teamHub.project')}: {taskState.projectName}</p> : null}
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamDetail.userGoal')}</p>
            <p className="whitespace-pre-wrap text-sm text-foreground">{teamState?.userGoal || taskState.userGoal || workspaceState.plan.userGoal}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamDetail.expectedOutcome')}</p>
            <p className="whitespace-pre-wrap text-sm text-foreground">{teamState?.expectedOutcome || taskState.expectedOutcome || workspaceState.plan.expectedOutcome}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('teamDetail.roles')}</CardTitle>
          <CardDescription>{t('teamDetail.rolesHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {roles.map((role) => (
            <div key={role.id} className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">{role.name}</span>
                <RoleKindBadge kind={role.kind} />
              </div>
              <p className="mt-2 text-sm text-foreground">{role.responsibility}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('teamDetail.stages')}</CardTitle>
          <CardDescription>{t('teamDetail.stagesHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {stageCards.map((stage, index) => (
            <div key={stage.id} className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-mono text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                <span className="text-sm font-medium text-foreground">{stage.title}</span>
                <Badge className={cn('border font-medium', TEAM_RUN_STATUS_CLASSNAME[stage.status])}>
                  {t(TEAM_RUN_STATUS_LABEL_KEY[stage.status])}
                </Badge>
                {stage.ownerName ? <Badge variant="outline">{stage.ownerName}</Badge> : null}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                {stage.summary || t('taskDetail.noSubtaskOutput')}
              </p>
              {stage.expectedOutput ? (
                <p className="mt-2 text-xs text-muted-foreground">{t('taskHub.expectedOutput')}: {stage.expectedOutput}</p>
              ) : null}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('teamDetail.outputs')}</CardTitle>
          <CardDescription>{t('teamDetail.outputsHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {outputs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('teamDetail.noOutputs')}</p>
          ) : (
            outputs.map((output, index) => (
              <div key={`${index}-${output.slice(0, 24)}`} className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
                <p className="whitespace-pre-wrap text-sm text-foreground">{output}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('teamDetail.runtimeArtifacts')}</CardTitle>
          <CardDescription>{t('teamDetail.runtimeArtifactsHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {runtimeArtifacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('teamDetail.noRuntimeArtifacts')}</p>
          ) : (
            runtimeArtifacts.map((artifact) => (
              <div key={artifact.artifactId} className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{artifact.title}</span>
                  <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.14em]">
                    {artifact.type}
                  </Badge>
                  {artifact.stageTitle ? <Badge variant="outline">{artifact.stageTitle}</Badge> : null}
                </div>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {artifact.sourcePath ? <p>{t('teamDetail.artifactPath')}: {artifact.sourcePath}</p> : null}
                  <p>{t('teamDetail.artifactSize')}: {formatBytes(artifact.size)}</p>
                  <p>{t('teamDetail.artifactContentType')}: {artifact.contentType}</p>
                </div>
                {activeRunId ? (
                  <RuntimeArtifactActions runId={activeRunId} artifact={artifact} />
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('teamDetail.runtime')}</CardTitle>
          <CardDescription>{t('teamDetail.runtimeHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-foreground">
          <div className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamDetail.session')}</p>
            <p className="mt-2">{taskState.sessionTitle}</p>
            {activeRunId ? <p className="mt-2 text-xs text-muted-foreground">runId: {activeRunId}</p> : null}
            {lifecycle.createdAt ? <p className="mt-2 text-xs text-muted-foreground">{t('team.workspace.created', { value: formatTimestamp(lifecycle.createdAt) })}</p> : null}
            {lifecycle.startedAt ? <p className="mt-1 text-xs text-muted-foreground">{t('team.workspace.started', { value: formatTimestamp(lifecycle.startedAt) })}</p> : null}
            {lifecycle.completedAt ? <p className="mt-1 text-xs text-muted-foreground">{t('team.workspace.completed', { value: formatTimestamp(lifecycle.completedAt) })}</p> : null}
            {lifecycle.publishedAt ? <p className="mt-1 text-xs text-muted-foreground">{t('team.workspace.published', { value: formatTimestamp(lifecycle.publishedAt) })}</p> : null}
          </div>
          {finalSummary ? (
            <div className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamHub.finalSummary')}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{finalSummary}</p>
            </div>
          ) : null}
          {blockedReason ? (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700 dark:text-rose-300">{t('teamHub.blockedReason')}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-rose-700 dark:text-rose-300">{blockedReason}</p>
            </div>
          ) : null}
          {lastError ? (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700 dark:text-rose-300">{t('team.workspace.lastError')}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-rose-700 dark:text-rose-300">{lastError}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{t('teamDetail.workspace')}</CardTitle>
            <CardDescription>{t('teamDetail.workspaceHint')}</CardDescription>
          </div>
          <Button variant="outline" onClick={() => setShowWorkspace((current) => !current)}>
            {showWorkspace ? t('teamDetail.hideWorkspace') : t('teamDetail.showWorkspace')}
          </Button>
        </CardHeader>
        {showWorkspace ? (
          <CardContent>
            {/* TeamWorkspacePanel removed */}
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}
