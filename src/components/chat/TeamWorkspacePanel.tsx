'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  TaskDetailProjectionResponseV1,
  TeamPlanApprovalStatus,
  TeamRunStatus,
  TeamWorkspaceProjectionV1,
} from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface TeamWorkspacePanelProps {
  taskId: string;
  standalone?: boolean;
}

const APPROVAL_BADGE_CLASSNAME: Record<TeamPlanApprovalStatus, string> = {
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  rejected: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

const RUN_BADGE_CLASSNAME: Record<TeamRunStatus, string> = {
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

function formatTimestamp(value?: string | null, fallback?: string): string {
  if (!value) return fallback || '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function TeamWorkspacePanel({ taskId, standalone = false }: TeamWorkspacePanelProps) {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useState<TeamWorkspaceProjectionV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/view`, { cache: 'no-store' });
      const data: Partial<TaskDetailProjectionResponseV1> & { error?: string } = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || t('team.workspace.loadFailed'));
      }

      setWorkspace(data.workspace || null);
    } catch (error) {
      setError(error instanceof Error ? error.message : t('team.workspace.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, taskId]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const approvalLabel = useMemo(() => {
    if (!workspace) return '';
    const key = {
      pending: 'team.approval.pending',
      approved: 'team.approval.approved',
      rejected: 'team.approval.rejected',
    } as const;
    return t(key[workspace.approvalStatus]);
  }, [t, workspace]);

  const runLabel = useMemo(() => {
    if (!workspace) return '';
    return t(`team.status.${workspace.run.status}` as const);
  }, [t, workspace]);

  const rootClassName = standalone
    ? 'space-y-4'
    : 'rounded-2xl border border-border/60 bg-card/70 p-4';

  if (loading) {
    return <div className={cn(rootClassName, 'text-sm text-muted-foreground')}>{t('common.loading')}</div>;
  }

  if (error) {
    return <div className={cn(rootClassName, 'text-sm text-destructive')}>{error}</div>;
  }

  if (!workspace) {
    return (
      <div className={cn(rootClassName, 'text-sm text-muted-foreground')}>
        No team workspace snapshot yet.
      </div>
    );
  }

  return (
    <div className={rootClassName}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge className={cn('border font-medium', APPROVAL_BADGE_CLASSNAME[workspace.approvalStatus])}>
          {approvalLabel}
        </Badge>
        <Badge className={cn('border font-medium', RUN_BADGE_CLASSNAME[workspace.run.status])}>
          {runLabel}
        </Badge>
        {workspace.runId ? (
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.14em]">
            runId: {workspace.runId}
          </Badge>
        ) : null}
      </div>

      {workspace.approvalStatus === 'pending' ? (
        <p className="text-sm text-muted-foreground">{t('team.workspace.pendingHint')}</p>
      ) : null}
      {workspace.approvalStatus === 'rejected' ? (
        <p className="text-sm text-muted-foreground">{t('team.workspace.rejectedHint')}</p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t('team.workspace.budget')}
          </p>
          <p className="mt-2 text-sm text-foreground">
            {t('team.workspace.budgetSummary', {
              workers: workspace.run.budget.maxParallelWorkers,
              retries: workspace.run.budget.maxRetriesPerTask,
              minutes: workspace.run.budget.maxRunMinutes,
            })}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t('team.workspace.lockScope', { value: workspace.run.lockScope })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('team.workspace.depth', { value: workspace.run.maxDepth })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('team.workspace.resumes', { value: workspace.run.resumeCount })}
          </p>
        </div>

        <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t('team.workspace.lifecycle')}
          </p>
          <p className="mt-2 text-sm text-foreground">
            {t('team.workspace.created', {
              value: formatTimestamp(workspace.run.createdAt, t('team.workspace.notStarted')),
            })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('team.workspace.started', {
              value: formatTimestamp(workspace.run.startedAt, t('team.workspace.notStarted')),
            })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('team.workspace.completed', {
              value: formatTimestamp(workspace.run.completedAt, t('team.workspace.notCompleted')),
            })}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('team.workspace.published', {
              value: formatTimestamp(workspace.run.context.publishedAt, t('team.workspace.notPublished')),
            })}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t('taskDetail.userGoal')}
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{workspace.plan.userGoal}</p>
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t('teamDetail.expectedOutcome')}
        </p>
        <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{workspace.plan.expectedOutcome}</p>
      </div>

      <div className="rounded-2xl border border-border/60 bg-background/60 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t('team.workspace.hierarchy')}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {workspace.plan.roles.map((role) => (
            <div
              key={role.id}
              className="rounded-xl border border-border/60 bg-card/80 px-3 py-2"
            >
              <p className="text-sm font-medium text-foreground">{role.name}</p>
              <p className="text-xs text-muted-foreground">{role.responsibility}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {t('team.workspace.phaseResults')}
        </p>
        {workspace.run.phases.map((phase) => (
          <div
            key={phase.id}
            className="rounded-2xl border border-border/60 bg-background/60 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{phase.title}</p>
              <Badge className={cn('border font-medium', RUN_BADGE_CLASSNAME[phase.status])}>
                {t(`team.status.${phase.status}` as const)}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{phase.expectedOutput}</p>
            <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
              {phase.latestResult || t('taskHub.currentStageNone')}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {t('team.workspace.updated', {
                value: formatTimestamp(phase.updatedAt, t('team.workspace.notUpdated')),
              })}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
