'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  TaskDirectoryItem,
  TeamDirectoryItem,
  TeamPlanApprovalStatus,
  TeamPlanRoleKind,
  TeamRunStatus,
} from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TeamWorkspacePanel } from '@/components/chat/TeamWorkspacePanel';
import { cn } from '@/lib/utils';

interface TeamRunDetailViewProps {
  team: TeamDirectoryItem;
  task: TaskDirectoryItem | null;
}

const TEAM_RUN_STATUS_CLASSNAME: Record<TeamRunStatus, string> = {
  pending: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  ready: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  running: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  waiting: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  blocked: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
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
  done: 'team.status.done',
  failed: 'team.status.failed',
} as const;

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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

export function TeamRunDetailView({ team, task }: TeamRunDetailViewProps) {
  const { t } = useTranslation();
  const [teamState, setTeamState] = useState(team);
  const [taskState, setTaskState] = useState(task);
  const [showWorkspace, setShowWorkspace] = useState(false);

  useEffect(() => {
    setTeamState(team);
  }, [team]);

  useEffect(() => {
    setTaskState(task);
  }, [task]);

  const loadLatest = useCallback(async () => {
    const response = await fetch('/api/tasks/catalog', { cache: 'no-store' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) return;

    const nextTeam = Array.isArray(data.teams)
      ? data.teams.find((item: TeamDirectoryItem) => item.id === team.id)
      : null;
    const nextTask = Array.isArray(data.tasks)
      ? data.tasks.find((item: TaskDirectoryItem) => item.id === team.relatedTaskId)
      : null;

    if (nextTeam) {
      setTeamState(nextTeam);
    }
    setTaskState(nextTask || null);
  }, [team.id, team.relatedTaskId]);

  const shouldPoll = !['done', 'failed', 'blocked'].includes(teamState.runStatus);

  useEffect(() => {
    if (!shouldPoll) return undefined;

    const interval = window.setInterval(() => {
      void loadLatest();
    }, 2000);

    return () => window.clearInterval(interval);
  }, [loadLatest, shouldPoll]);

  const runStatusLabel = useMemo(() => {
    return t(TEAM_RUN_STATUS_LABEL_KEY[teamState.runStatus]);
  }, [t, teamState.runStatus]);

  const approvalStatusLabel = useMemo(() => {
    const key = {
      pending: 'team.approval.pending',
      approved: 'team.approval.approved',
      rejected: 'team.approval.rejected',
    } as const;
    return t(key[teamState.approvalStatus]);
  }, [t, teamState.approvalStatus]);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{teamState.title}</h1>
            <Badge className={cn('border font-medium', TEAM_APPROVAL_CLASSNAME[teamState.approvalStatus])}>
              {approvalStatusLabel}
            </Badge>
            <Badge className={cn('border font-medium', TEAM_RUN_STATUS_CLASSNAME[teamState.runStatus])}>
              {runStatusLabel}
            </Badge>
          </div>
          <p className="max-w-4xl text-sm text-muted-foreground">{teamState.summary}</p>
          <p className="text-sm text-muted-foreground">
            {t('teamDetail.handoff', {
              executor: teamState.currentExecutorName || teamState.executorLabel,
            })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/team">{t('teamDetail.backToTeams')}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={teamState.relatedTaskPath}>{t('teamDetail.openTask')}</Link>
          </Button>
          <Button asChild>
            <Link href={`/main-agent/${teamState.sessionId}`}>{t('teamHub.openSession')}</Link>
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
            <p>{t('teamDetail.createdScenario')}: {teamState.createdScenario}</p>
            <p>{t('teamDetail.linkedTask')}: {taskState?.title || teamState.title}</p>
            <p>{t('teamDetail.currentStage')}: {teamState.currentStage || t('teamHub.currentStageNone')}</p>
            <p>{t('teamDetail.currentExecutor')}: {teamState.currentExecutorName || teamState.executorLabel}</p>
            <p>{t('teamDetail.progress')}: {teamState.completedTaskCount}/{teamState.taskCount}</p>
            <p>{t('teamDetail.updatedAt')}: {formatTimestamp(teamState.updatedAt)}</p>
            {teamState.projectName ? <p>{t('teamHub.project')}: {teamState.projectName}</p> : null}
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamDetail.userGoal')}</p>
            <p className="whitespace-pre-wrap text-sm text-foreground">{teamState.userGoal}</p>
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamDetail.expectedOutcome')}</p>
            <p className="whitespace-pre-wrap text-sm text-foreground">{teamState.expectedOutcome}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('teamDetail.roles')}</CardTitle>
          <CardDescription>{t('teamDetail.rolesHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {teamState.roles.map((role) => (
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
          {teamState.artifacts.map((artifact, index) => (
            <div key={artifact.id} className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-mono text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                <span className="text-sm font-medium text-foreground">{artifact.title}</span>
                <Badge className={cn('border font-medium', TEAM_RUN_STATUS_CLASSNAME[artifact.status as TeamRunStatus])}>
                  {t(TEAM_RUN_STATUS_LABEL_KEY[artifact.status as TeamRunStatus])}
                </Badge>
                {artifact.ownerName ? <Badge variant="outline">{artifact.ownerName}</Badge> : null}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                {artifact.summary || t('taskDetail.noSubtaskOutput')}
              </p>
              {artifact.expectedOutput ? (
                <p className="mt-2 text-xs text-muted-foreground">{t('taskHub.expectedOutput')}: {artifact.expectedOutput}</p>
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
          {teamState.outputs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('teamDetail.noOutputs')}</p>
          ) : (
            teamState.outputs.map((output, index) => (
              <div key={`${index}-${output.slice(0, 24)}`} className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
                <p className="whitespace-pre-wrap text-sm text-foreground">{output}</p>
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
            <p className="mt-2">{teamState.sessionTitle}</p>
          </div>
          {teamState.finalSummary ? (
            <div className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamHub.finalSummary')}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{teamState.finalSummary}</p>
            </div>
          ) : null}
          {teamState.blockedReason ? (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700 dark:text-rose-300">{t('teamHub.blockedReason')}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-rose-700 dark:text-rose-300">{teamState.blockedReason}</p>
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
            <TeamWorkspacePanel taskId={teamState.id} standalone />
          </CardContent>
        ) : null}
      </Card>
    </div>
  );
}
