'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TaskDirectoryItem, TaskStatus, TeamRunStatus } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TeamWorkspacePanel } from '@/components/chat/TeamWorkspacePanel';
import { cn } from '@/lib/utils';

interface TaskDetailViewProps {
  taskId: string;
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

const MANUAL_TASK_STATUS_CLASSNAME: Record<TaskStatus, string> = {
  pending: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  in_progress: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  failed: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
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

const MANUAL_TASK_STATUS_LABEL_KEY = {
  pending: 'taskHub.status.pending',
  in_progress: 'taskHub.status.inProgress',
  completed: 'taskHub.status.completed',
  failed: 'taskHub.status.failed',
} as const;

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function TaskDetailView({ taskId }: TaskDetailViewProps) {
  const { t } = useTranslation();
  const [task, setTask] = useState<TaskDirectoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showWorkspace, setShowWorkspace] = useState(false);

  const loadTask = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
      setError('');
    }

    const response = await fetch(`/api/tasks/catalog/${encodeURIComponent(taskId)}`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to load task');
    }

    setTask(data.task || null);
    if (!silent) {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadTask()
        .catch((error) => {
          if (cancelled) return;
          setError(error instanceof Error ? error.message : 'Failed to load task');
          setLoading(false);
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadTask]);

  const shouldPoll = task?.source === 'team' && !['done', 'failed', 'blocked'].includes(task.status);

  useEffect(() => {
    if (!shouldPoll) return undefined;

    const interval = window.setInterval(() => {
      void loadTask({ silent: true }).catch(() => {
        // Best effort only.
      });
    }, 2000);

    return () => window.clearInterval(interval);
  }, [loadTask, shouldPoll]);

  const statusLabel = useMemo(() => {
    if (!task) return '';
    if (task.source === 'team') {
      return t(TEAM_RUN_STATUS_LABEL_KEY[task.status as TeamRunStatus]);
    }

    return t(MANUAL_TASK_STATUS_LABEL_KEY[task.status as TaskStatus]);
  }, [task, t]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-6 text-sm text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('taskDetail.notFound')}</CardTitle>
            <CardDescription>{error || t('taskDetail.notFoundHint')}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const badgeClassName = task.source === 'team'
    ? TEAM_RUN_STATUS_CLASSNAME[task.status as TeamRunStatus]
    : MANUAL_TASK_STATUS_CLASSNAME[task.status as TaskStatus];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{task.title}</h1>
            <Badge className={cn('border font-medium', badgeClassName)}>{statusLabel}</Badge>
            <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.14em]">
              {task.source === 'team' ? t('taskHub.source.team') : t('taskHub.source.manual')}
            </Badge>
          </div>
          <p className="max-w-4xl text-sm text-muted-foreground">{task.summary}</p>
          <p className="text-sm text-muted-foreground">
            {t('taskDetail.handoff', {
              executor: task.currentExecutorName || task.executorLabel,
            })}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link href="/tasks">{t('taskDetail.backToTasks')}</Link>
          </Button>
          {task.teamId ? (
            <Button variant="outline" asChild>
              <Link href={`/team/${task.teamId}`}>{t('taskDetail.openTeamTab')}</Link>
            </Button>
          ) : null}
          <Button asChild>
            <Link href={`/main-agent/${task.sessionId}`}>{t('taskHub.openSession')}</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('taskDetail.overview')}</CardTitle>
          <CardDescription>{t('taskDetail.overviewHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{t('taskDetail.createdScenario')}: {task.createdScenario}</p>
            <p>{t('taskDetail.executor')}: {task.currentExecutorName || task.executorLabel}</p>
            <p>{t('taskDetail.progress')}: {task.progressCompleted}/{task.progressTotal}</p>
            <p>{t('taskDetail.currentStage')}: {task.currentStage || t('taskHub.currentStageNone')}</p>
            <p>{t('taskDetail.updatedAt')}: {formatTimestamp(task.updatedAt)}</p>
            {task.teamTitle ? <p>{t('taskDetail.linkedTeam')}: {task.teamTitle}</p> : null}
          </div>

          {task.userGoal ? (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('taskDetail.userGoal')}</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{task.userGoal}</p>
            </div>
          ) : null}

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('taskDetail.summaryLabel')}</p>
            <p className="whitespace-pre-wrap text-sm text-foreground">{task.summary}</p>
          </div>

          {task.expectedOutput ? (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('taskHub.expectedOutput')}</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{task.expectedOutput}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('taskDetail.subtasks')}</CardTitle>
          <CardDescription>{t('taskDetail.subtasksHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {task.artifacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('taskDetail.noSubtasks')}</p>
          ) : (
            task.artifacts.map((artifact, index) => (
              <div key={artifact.id} className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-mono text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                  <span className="text-sm font-medium text-foreground">{artifact.title}</span>
                  <Badge
                    className={cn(
                      'border font-medium',
                      task.source === 'team'
                        ? TEAM_RUN_STATUS_CLASSNAME[artifact.status as TeamRunStatus]
                        : MANUAL_TASK_STATUS_CLASSNAME[artifact.status as TaskStatus],
                    )}
                  >
                    {task.source === 'team'
                      ? t(TEAM_RUN_STATUS_LABEL_KEY[artifact.status as TeamRunStatus])
                      : t(MANUAL_TASK_STATUS_LABEL_KEY[artifact.status as TaskStatus])}
                  </Badge>
                  {artifact.ownerName ? (
                    <Badge variant="outline">{artifact.ownerName}</Badge>
                  ) : null}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{artifact.summary || t('taskDetail.noSubtaskOutput')}</p>
                {artifact.expectedOutput ? (
                  <p className="mt-2 text-xs text-muted-foreground">{t('taskHub.expectedOutput')}: {artifact.expectedOutput}</p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {artifact.dependsOn.length > 0
                    ? `${t('taskHub.dependsOn')}: ${artifact.dependsOn.join(', ')}`
                    : `${t('taskHub.dependsOn')}: ${t('taskHub.dependsOnNone')}`}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('taskDetail.outputs')}</CardTitle>
          <CardDescription>{t('taskDetail.outputsHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {task.outputs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('taskDetail.noOutputs')}</p>
          ) : (
            task.outputs.map((output, index) => (
              <div key={`${index}-${output.slice(0, 24)}`} className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-4 text-sm text-foreground">
                <p className="whitespace-pre-wrap">{output}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('taskDetail.links')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button variant="outline" asChild>
            <Link href={`/main-agent/${task.sessionId}`}>{t('taskHub.openSession')}</Link>
          </Button>
          {task.teamId ? (
            <Button variant="outline" asChild>
              <Link href={`/team/${task.teamId}`}>{t('taskDetail.openTeamTab')}</Link>
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {task.source === 'team' ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>{t('taskDetail.workspace')}</CardTitle>
              <CardDescription>{t('taskDetail.workspaceHint')}</CardDescription>
            </div>
            <Button variant="outline" onClick={() => setShowWorkspace((current) => !current)}>
              {showWorkspace ? t('taskDetail.hideWorkspace') : t('taskDetail.showWorkspace')}
            </Button>
          </CardHeader>
          {showWorkspace ? (
            <CardContent>
              <TeamWorkspacePanel taskId={task.id} standalone />
            </CardContent>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
