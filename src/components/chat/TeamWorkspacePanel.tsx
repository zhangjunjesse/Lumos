'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TaskItem, TeamPlanRoleKind, TeamRunStatus } from '@/types';
import { parseTeamPlanTaskRecord, TEAM_PLAN_TASK_KIND } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { TranslationKey } from '@/i18n';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

interface TeamWorkspacePanelProps {
  sessionId?: string;
  taskId?: string;
  standalone?: boolean;
}

interface TasksResponse {
  tasks?: TaskItem[];
}

const STATUS_OPTIONS: TeamRunStatus[] = ['pending', 'ready', 'running', 'waiting', 'blocked', 'done', 'failed'];

const STATUS_CLASSNAME: Record<TeamRunStatus, string> = {
  pending: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  ready: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  running: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  waiting: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  blocked: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  done: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  failed: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
};

const STATUS_LABEL_KEY: Record<TeamRunStatus, TranslationKey> = {
  pending: 'team.status.pending',
  ready: 'team.status.ready',
  running: 'team.status.running',
  waiting: 'team.status.waiting',
  blocked: 'team.status.blocked',
  done: 'team.status.done',
  failed: 'team.status.failed',
};

const ROLE_KIND_LABEL_KEY: Record<TeamPlanRoleKind, TranslationKey> = {
  main_agent: 'team.role.mainAgent',
  orchestrator: 'team.role.orchestrator',
  lead: 'team.role.lead',
  worker: 'team.role.worker',
};

export function TeamWorkspacePanel({ sessionId, taskId, standalone = false }: TeamWorkspacePanelProps) {
  const { t } = useTranslation();
  const [teamTask, setTeamTask] = useState<TaskItem | null>(null);
  const [savingKey, setSavingKey] = useState<string>('');
  const [phaseDrafts, setPhaseDrafts] = useState<Record<string, string>>({});
  const [phaseStatuses, setPhaseStatuses] = useState<Record<string, TeamRunStatus>>({});
  const [teamSummaryDraft, setTeamSummaryDraft] = useState('');
  const [finalSummaryDraft, setFinalSummaryDraft] = useState('');
  const [blockedReasonDraft, setBlockedReasonDraft] = useState('');
  const [lastErrorDraft, setLastErrorDraft] = useState('');

  const loadTeamTask = useCallback(async () => {
    if (!sessionId && !taskId) return;
    try {
      const response = await fetch(
        taskId
          ? `/api/tasks/${encodeURIComponent(taskId)}`
          : `/api/tasks?session_id=${encodeURIComponent(sessionId || '')}&kind=${TEAM_PLAN_TASK_KIND}`,
      );
      if (!response.ok) return;
      const data: TasksResponse & { task?: TaskItem } = await response.json();
      if (taskId) {
        setTeamTask(data.task || null);
        return;
      }
      const tasks = data.tasks || [];
      setTeamTask(tasks.length > 0 ? tasks[tasks.length - 1] : null);
    } catch {
      // Best effort only.
    }
  }, [sessionId, taskId]);

  useEffect(() => {
    void loadTeamTask();
  }, [loadTeamTask]);

  useEffect(() => {
    const handleRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (taskId || !detail?.sessionId || detail.sessionId === sessionId) {
        void loadTeamTask();
      }
    };

    window.addEventListener('team-plan-refresh', handleRefresh);
    return () => window.removeEventListener('team-plan-refresh', handleRefresh);
  }, [loadTeamTask, sessionId, taskId]);

  const record = useMemo(() => parseTeamPlanTaskRecord(teamTask?.description), [teamTask]);
  const isApproved = record?.approvalStatus === 'approved';
  const shouldPoll = record?.approvalStatus === 'approved'
    && !['done', 'failed', 'blocked'].includes(record.run.status);
  const publishSummaryBody = finalSummaryDraft.trim() || teamSummaryDraft.trim();
  const getStatusLabel = useCallback((status: TeamRunStatus) => t(STATUS_LABEL_KEY[status]), [t]);
  const getRoleKindLabel = useCallback((kind: TeamPlanRoleKind) => t(ROLE_KIND_LABEL_KEY[kind]), [t]);
  const lockScopeLabel = t('team.lockScope.sessionRuntime');

  useEffect(() => {
    if (!shouldPoll) return undefined;

    const interval = window.setInterval(() => {
      void loadTeamTask();
    }, 2000);

    return () => window.clearInterval(interval);
  }, [loadTeamTask, shouldPoll]);

  useEffect(() => {
    if (!record) return;

    const nextDrafts: Record<string, string> = {};
    const nextStatuses: Record<string, TeamRunStatus> = {};
    for (const phase of record.run.phases) {
      nextDrafts[phase.id] = phase.latestResult || '';
      nextStatuses[phase.id] = phase.status;
    }

    setPhaseDrafts(nextDrafts);
    setPhaseStatuses(nextStatuses);
    setTeamSummaryDraft(record.run.context.summary || '');
    setFinalSummaryDraft(record.run.context.finalSummary || '');
    setBlockedReasonDraft(record.run.context.blockedReason || '');
    setLastErrorDraft(record.run.context.lastError || '');
  }, [record]);

  const patchTask = useCallback(async (body: Record<string, unknown>) => {
    if (!teamTask) return false;
    setSavingKey(JSON.stringify(body));
    try {
      const response = await fetch(`/api/tasks/${teamTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) return false;
      await loadTeamTask();
      window.dispatchEvent(new CustomEvent('team-plan-refresh', { detail: { sessionId } }));
      return true;
    } finally {
      setSavingKey('');
    }
  }, [loadTeamTask, sessionId, teamTask]);

  const handleSavePhase = useCallback(async (phaseId: string) => {
    await patchTask({
      phaseId,
      phaseStatus: phaseStatuses[phaseId],
      phaseLatestResult: phaseDrafts[phaseId] || '',
    });
  }, [patchTask, phaseDrafts, phaseStatuses]);

  const handleSaveContext = useCallback(async () => {
    await patchTask({
      teamSummary: teamSummaryDraft,
      finalSummary: finalSummaryDraft,
      blockedReason: blockedReasonDraft,
      lastError: lastErrorDraft,
    });
  }, [blockedReasonDraft, finalSummaryDraft, lastErrorDraft, patchTask, teamSummaryDraft]);

  const handleResume = useCallback(async () => {
    await patchTask({ resumeRun: true });
  }, [patchTask]);

  const handlePublishSummary = useCallback(async () => {
    if (!record) return;
    const finalSummary = finalSummaryDraft.trim();
    const summaryBody = finalSummary || teamSummaryDraft.trim();
    if (!summaryBody) return;

    const content = [
      t('team.workspace.publishMessageTitle'),
      '',
      t('team.workspace.publishStatus', { status: getStatusLabel(record.run.status) }),
      '',
      summaryBody,
    ].join('\n');

    setSavingKey('publish-summary');
    try {
      const response = await fetch('/api/chat/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId || teamTask?.session_id,
          role: 'assistant',
          content,
        }),
      });
      if (!response.ok) return;
      await patchTask({
        publishSummary: true,
        ...(finalSummary ? { finalSummary } : {}),
      });
      const effectiveSessionId = sessionId || teamTask?.session_id || '';
      if (effectiveSessionId) {
        window.dispatchEvent(new CustomEvent('session-updated', { detail: { id: effectiveSessionId } }));
        window.dispatchEvent(new CustomEvent('team-chat-message-created', { detail: { sessionId: effectiveSessionId } }));
      }
    } finally {
      setSavingKey('');
    }
  }, [finalSummaryDraft, getStatusLabel, patchTask, record, sessionId, t, teamSummaryDraft, teamTask?.session_id]);

  const sectionClassName = standalone
    ? 'bg-background px-0 py-0'
    : 'border-b border-border/60 bg-background px-4 py-4';

  if (!record) {
    return null;
  }

  if (!isApproved) {
    return (
      <section className={sectionClassName}>
        <div className="mx-auto max-w-5xl rounded-2xl border border-dashed border-border/70 bg-muted/20 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{t('team.workspace.title')}</h3>
            <Badge className={cn('border font-medium', STATUS_CLASSNAME[record.run.status])}>
              {getStatusLabel(record.run.status)}
            </Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {record.approvalStatus === 'pending'
              ? t('team.workspace.pendingHint')
              : t('team.workspace.rejectedHint')}
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-3 text-xs text-muted-foreground">
              <p className="font-semibold uppercase tracking-[0.14em]">{t('team.workspace.hierarchy')}</p>
              <p className="mt-2">{record.run.hierarchy.map(getRoleKindLabel).join(' -> ')}</p>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-3 text-xs text-muted-foreground">
              <p className="font-semibold uppercase tracking-[0.14em]">{t('team.workspace.budget')}</p>
              <p className="mt-2">
                {t('team.workspace.budgetSummary', {
                  workers: record.run.budget.maxParallelWorkers,
                  retries: record.run.budget.maxRetriesPerTask,
                  minutes: record.run.budget.maxRunMinutes,
                })}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/70 px-3 py-3 text-xs text-muted-foreground">
              <p className="font-semibold uppercase tracking-[0.14em]">{t('team.workspace.runtimeBoundary')}</p>
              <p className="mt-2">{t('team.workspace.lockScope', { value: lockScopeLabel })}</p>
              <p className="mt-1">{t('team.workspace.permissionsBoundary')}</p>
            </div>
          </div>
          {record.run.context.blockedReason ? (
            <p className="mt-3 text-xs text-rose-700 dark:text-rose-300">
              {t('team.workspace.reason', { value: record.run.context.blockedReason })}
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className={sectionClassName}>
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{t('team.workspace.title')}</h3>
              <Badge className={cn('border font-medium', STATUS_CLASSNAME[record.run.status])}>
                {getStatusLabel(record.run.status)}
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.14em]">
                {t('team.workspace.depth', { value: record.run.maxDepth })}
              </Badge>
              <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.14em]">
                {t('team.workspace.resumes', { value: record.run.resumeCount })}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('team.workspace.summaryHandoff')}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResume}
              disabled={savingKey !== '' || record.approvalStatus !== 'approved'}
            >
              {t('team.workspace.resumeRun')}
            </Button>
            <Button
              size="sm"
              onClick={handlePublishSummary}
              disabled={savingKey !== '' || !publishSummaryBody}
            >
              {t('team.workspace.publishSummary')}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('team.workspace.budget')}</p>
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p>{t('team.workspace.maxParallelWorkers', { value: record.run.budget.maxParallelWorkers })}</p>
              <p>{t('team.workspace.maxRetriesPerTask', { value: record.run.budget.maxRetriesPerTask })}</p>
              <p>{t('team.workspace.maxRunMinutes', { value: record.run.budget.maxRunMinutes })}</p>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('team.workspace.hierarchyGuardrails')}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {record.run.hierarchy.map((item) => (
                <Badge key={item} variant="outline" className="font-mono text-[10px] uppercase tracking-[0.14em]">
                  {getRoleKindLabel(item)}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t('team.workspace.hierarchyBoundary')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('team.workspace.lockScope', { value: lockScopeLabel })}
            </p>
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('team.workspace.lifecycle')}</p>
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p>{t('team.workspace.created', { value: record.run.createdAt || t('team.workspace.notStarted') })}</p>
              <p>{t('team.workspace.started', { value: record.run.startedAt || t('team.workspace.notStarted') })}</p>
              <p>{t('team.workspace.completed', { value: record.run.completedAt || t('team.workspace.notCompleted') })}</p>
              <p>{t('team.workspace.published', { value: record.run.context.publishedAt || t('team.workspace.notPublished') })}</p>
            </div>
          </div>
        </div>

        {(record.run.context.blockedReason || record.run.context.lastError) ? (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-700 dark:text-rose-300">
              {t('team.workspace.visibleExceptions')}
            </p>
            {record.run.context.blockedReason ? (
              <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">
                {t('team.workspace.blocked', { value: record.run.context.blockedReason })}
              </p>
            ) : null}
            {record.run.context.lastError ? (
              <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">
                {t('team.workspace.error', { value: record.run.context.lastError })}
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('team.workspace.phaseResults')}</h4>
            <span className="text-xs text-muted-foreground">
              {t('team.workspace.dependencyHint', {
                running: getStatusLabel('running'),
                done: getStatusLabel('done'),
              })}
            </span>
          </div>

          <div className="space-y-3">
            {record.run.phases.map((phase) => {
              const owner = record.plan.roles.find((role) => role.id === phase.ownerRoleId);
              const busy = savingKey.includes(`"phaseId":"${phase.id}"`);
              return (
                <div key={phase.id} className="rounded-2xl border border-border/60 bg-card px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{phase.title}</span>
                    <Badge className={cn('border font-medium', STATUS_CLASSNAME[phase.status])}>
                      {getStatusLabel(phase.status)}
                    </Badge>
                    {owner ? (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {owner.name}
                      </Badge>
                    ) : null}
                  </div>

                  <div className="mt-2 grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
                    <div className="space-y-2 text-xs text-muted-foreground">
                      <p>{t('team.plan.expectedOutput', { value: phase.expectedOutput })}</p>
                      <p>
                        {phase.dependsOn.length > 0
                          ? t('team.plan.dependsOn', { value: phase.dependsOn.join(', ') })
                          : t('team.plan.dependsOnNone')}
                      </p>
                      <p>{t('team.workspace.updated', { value: phase.updatedAt || t('team.workspace.notUpdated') })}</p>
                      <label className="block space-y-1">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('team.workspace.status')}</span>
                        <select
                          value={phaseStatuses[phase.id] || phase.status}
                          onChange={(event) => setPhaseStatuses((current) => ({
                            ...current,
                            [phase.id]: event.target.value as TeamRunStatus,
                          }))}
                          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none"
                        >
                          {STATUS_OPTIONS.map((status) => (
                            <option key={status} value={status}>{getStatusLabel(status)}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="space-y-2">
                      <Textarea
                        value={phaseDrafts[phase.id] || ''}
                        onChange={(event) => setPhaseDrafts((current) => ({
                          ...current,
                          [phase.id]: event.target.value,
                        }))}
                        rows={4}
                        placeholder={t('team.workspace.phasePlaceholder')}
                      />
                      <div className="flex justify-end">
                        <Button size="sm" variant="outline" onClick={() => void handleSavePhase(phase.id)} disabled={busy || savingKey !== ''}>
                          {t('team.workspace.savePhase')}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-border/60 bg-card px-4 py-4">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('team.workspace.teamContextSummary')}</h4>
              <Textarea
                value={teamSummaryDraft}
                onChange={(event) => setTeamSummaryDraft(event.target.value)}
                rows={6}
                placeholder={t('team.workspace.teamContextPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">
                {record.run.context.summarySource === 'manual'
                  ? t('team.workspace.summaryManual')
                  : t('team.workspace.summaryAuto')}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card px-4 py-4">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('team.workspace.finalSummary')}</h4>
              <Textarea
                value={finalSummaryDraft}
                onChange={(event) => setFinalSummaryDraft(event.target.value)}
                rows={6}
                placeholder={t('team.workspace.finalSummaryPlaceholder')}
              />
              <p className="text-xs text-muted-foreground">
                {record.run.context.finalSummarySource === 'manual'
                  ? t('team.workspace.finalSummaryManual')
                  : t('team.workspace.finalSummaryAuto')}
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-border/60 bg-card px-4 py-4">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('team.workspace.blockedReason')}</h4>
              <Textarea
                value={blockedReasonDraft}
                onChange={(event) => setBlockedReasonDraft(event.target.value)}
                rows={3}
                placeholder={t('team.workspace.blockedReasonPlaceholder')}
              />
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card px-4 py-4">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('team.workspace.lastError')}</h4>
              <Textarea
                value={lastErrorDraft}
                onChange={(event) => setLastErrorDraft(event.target.value)}
                rows={3}
                placeholder={t('team.workspace.lastErrorPlaceholder')}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={handleSaveContext} disabled={savingKey !== ''}>
            {t('team.workspace.saveWorkspaceState')}
          </Button>
        </div>
      </div>
    </section>
  );
}
