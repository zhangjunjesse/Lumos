'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TaskItem } from '@/types';
import { parseTeamPlanTaskRecord, TEAM_PLAN_TASK_KIND } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/useTranslation';
import { TeamPlanCard } from './TeamPlanCard';
import { cn } from '@/lib/utils';

interface TeamModeBannerProps {
  sessionId: string;
}

interface TasksResponse {
  tasks?: TaskItem[];
}

const STATUS_CLASSNAME = {
  pending: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  ready: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-slate-300',
  running: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  waiting: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  blocked: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  done: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  failed: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
} as const;

const STATUS_LABEL_KEY = {
  pending: 'team.status.pending',
  ready: 'team.status.ready',
  running: 'team.status.running',
  waiting: 'team.status.waiting',
  blocked: 'team.status.blocked',
  done: 'team.status.done',
  failed: 'team.status.failed',
} as const;

export function TeamModeBanner({ sessionId }: TeamModeBannerProps) {
  const { t } = useTranslation();
  const [teamTasks, setTeamTasks] = useState<TaskItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  const loadTeamTasks = useCallback(async () => {
    if (!sessionId) return;

    try {
      const response = await fetch(`/api/tasks?session_id=${encodeURIComponent(sessionId)}&kind=${TEAM_PLAN_TASK_KIND}`);
      if (!response.ok) return;

      const data: TasksResponse = await response.json();
      setTeamTasks(data.tasks || []);
    } catch {
      // Best effort only.
    }
  }, [sessionId]);

  useEffect(() => {
    void loadTeamTasks();
  }, [loadTeamTasks]);

  useEffect(() => {
    const handleRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (!detail?.sessionId || detail.sessionId === sessionId) {
        void loadTeamTasks();
      }
    };

    window.addEventListener('team-plan-refresh', handleRefresh);
    return () => window.removeEventListener('team-plan-refresh', handleRefresh);
  }, [loadTeamTasks, sessionId]);

  const records = useMemo(() => teamTasks
    .map((task) => {
      const record = parseTeamPlanTaskRecord(task.description);
      return record ? { task, record } : null;
    })
    .filter((item): item is { task: TaskItem; record: NonNullable<ReturnType<typeof parseTeamPlanTaskRecord>> } => Boolean(item)), [teamTasks]);

  const latest = records[records.length - 1] || null;
  const shouldPoll = latest?.record.approvalStatus === 'approved'
    && !['done', 'failed', 'blocked'].includes(latest.record.run.status);

  useEffect(() => {
    if (!shouldPoll) return undefined;

    const interval = window.setInterval(() => {
      void loadTeamTasks();
    }, 2000);

    return () => window.clearInterval(interval);
  }, [loadTeamTasks, shouldPoll]);

  const handleApproval = useCallback(async (approvalStatus: 'approved' | 'rejected') => {
    if (!latest) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/tasks/${latest.task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvalStatus }),
      });
      if (!response.ok) return;

      await loadTeamTasks();
      setExpandedPlanId(null);
      window.dispatchEvent(new CustomEvent('team-plan-refresh', { detail: { sessionId } }));
    } finally {
      setBusy(false);
    }
  }, [latest, loadTeamTasks, sessionId]);

  if (!latest) {
    return (
      <div className="border-b border-border/60 bg-muted/20 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.14em]">
            {t('team.badge.mainAgent')}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {t('team.banner.off')}
          </span>
        </div>
      </div>
    );
  }

  if (latest.record.approvalStatus === 'pending') {
    const completedCount = latest.record.run.phases.filter((phase) => phase.status === 'done').length;
    const currentPhase = latest.record.run.phases.find((phase) => ['running', 'waiting', 'blocked', 'ready'].includes(phase.status))
      || latest.record.run.phases.find((phase) => phase.status === 'done');
    const expanded = expandedPlanId === latest.task.id;

    return (
      <div className="border-b border-border/60 bg-muted/12 px-4 py-3">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card/90 px-4 py-3">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.14em]">
                {t('team.badge.mainAgent')}
              </Badge>
              <Badge className={cn('border font-medium', STATUS_CLASSNAME.pending)}>
                {t('team.approval.pending')}
              </Badge>
              <span className="text-sm font-semibold text-foreground">{latest.record.plan.summary}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('team.banner.pendingSummary', {
                completed: completedCount,
                total: latest.record.plan.tasks.length,
                count: records.length,
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              {currentPhase
                ? t('team.banner.currentPhase', { value: currentPhase.title })
                : t('team.banner.currentPhaseNone')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/tasks/${latest.task.id}`}>{t('team.banner.openTask')}</Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpandedPlanId((current) => current === latest.task.id ? null : latest.task.id)}
            >
              {expanded ? t('team.banner.hidePlan') : t('team.banner.reviewPlan')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleApproval('rejected')} disabled={busy}>
              {t('team.plan.stayMainAgent')}
            </Button>
            <Button size="sm" onClick={() => void handleApproval('approved')} disabled={busy}>
              {t('team.plan.approve')}
            </Button>
          </div>
        </div>
        {expanded ? (
          <div className="mx-auto max-w-5xl pt-3">
            <TeamPlanCard
              plan={latest.record.plan}
              run={latest.record.run}
              approvalStatus={latest.record.approvalStatus}
              compact
            />
          </div>
        ) : null}
      </div>
    );
  }

  const recentRecords = records.slice(-3).reverse();

  return (
    <div className="border-b border-border/60 bg-muted/12 px-4 py-3">
      <div className="mx-auto max-w-5xl rounded-2xl border border-border/60 bg-card/90 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.14em]">
                {t('team.badge.mainAgent')}
              </Badge>
              <span className="text-sm font-semibold text-foreground">
                {t('team.banner.sessionTasks', { count: records.length })}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{t('team.banner.handoff')}</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/tasks">{t('team.banner.viewAllTasks')}</Link>
          </Button>
        </div>

        <div className="mt-4 space-y-3">
          {recentRecords.map(({ task, record }) => {
            const currentPhase = record.run.phases.find((phase) => ['running', 'waiting', 'blocked', 'ready'].includes(phase.status))
              || record.run.phases.find((phase) => phase.status === 'done');
            const statusLabel = record.approvalStatus === 'rejected'
              ? t('team.approval.rejected')
              : t(STATUS_LABEL_KEY[record.run.status]);
            const badgeClassName = record.approvalStatus === 'rejected'
              ? STATUS_CLASSNAME.failed
              : STATUS_CLASSNAME[record.run.status];

            return (
              <div key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/50 bg-muted/[0.06] px-4 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className={cn('border font-medium', badgeClassName)}>{statusLabel}</Badge>
                    <span className="text-sm font-medium text-foreground">{record.plan.summary}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {currentPhase
                      ? t('team.banner.currentPhase', { value: currentPhase.title })
                      : t('team.banner.currentPhaseNone')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/tasks/${task.id}`}>{t('team.banner.openTask')}</Link>
                  </Button>
                  <Button size="sm" asChild>
                    <Link href={`/team/${task.id}`}>{t('team.banner.openTeam')}</Link>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {records.length > recentRecords.length ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {t('team.banner.moreTasks', { count: records.length - recentRecords.length })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
