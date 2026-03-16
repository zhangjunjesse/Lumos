'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type {
  AgentPresetDirectoryItem,
  CreateAgentPresetRequest,
  CreateTeamTemplateRequest,
  MainAgentCatalogResponse,
  TaskDirectoryItem,
  TaskStatus,
  TeamAgentPresetRoleKind,
  TeamDirectoryItem,
  TeamPlanApprovalStatus,
  TeamRunStatus,
  TeamTemplateDirectoryItem,
} from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

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

const MANUAL_TASK_STATUS_CLASSNAME: Record<TaskStatus, string> = {
  pending: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  in_progress: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  failed: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
};

const ROLE_KIND_LABEL_KEY: Record<TeamAgentPresetRoleKind, 'team.role.orchestrator' | 'team.role.lead' | 'team.role.worker'> = {
  orchestrator: 'team.role.orchestrator',
  lead: 'team.role.lead',
  worker: 'team.role.worker',
};

const EMPTY_CATALOG: MainAgentCatalogResponse = {
  teams: [],
  tasks: [],
  agentPresets: [],
  teamTemplates: [],
};

interface AgentPresetFormState {
  name: string;
  roleKind: TeamAgentPresetRoleKind;
  responsibility: string;
  systemPrompt: string;
  description: string;
  collaborationStyle: string;
  outputContract: string;
}

interface TeamTemplateFormState {
  name: string;
  summary: string;
  activationHint: string;
  defaultGoal: string;
  defaultOutcome: string;
  notes: string;
  agentPresetIds: string[];
}

function createEmptyAgentForm(): AgentPresetFormState {
  return {
    name: '',
    roleKind: 'lead',
    responsibility: '',
    systemPrompt: '',
    description: '',
    collaborationStyle: '',
    outputContract: '',
  };
}

function createEmptyTemplateForm(): TeamTemplateFormState {
  return {
    name: '',
    summary: '',
    activationHint: '',
    defaultGoal: '',
    defaultOutcome: '',
    notes: '',
    agentPresetIds: [],
  };
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function useMainAgentCatalog() {
  const [catalog, setCatalog] = useState<MainAgentCatalogResponse>(EMPTY_CATALOG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const response = await fetch('/api/tasks/catalog', { cache: 'no-store' });
      const data = await response.json().catch(() => EMPTY_CATALOG);
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load catalog');
      }
      setCatalog({
        teams: Array.isArray(data.teams) ? data.teams : [],
        tasks: Array.isArray(data.tasks) ? data.tasks : [],
        agentPresets: Array.isArray(data.agentPresets) ? data.agentPresets : [],
        teamTemplates: Array.isArray(data.teamTemplates) ? data.teamTemplates : [],
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load catalog');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shouldPoll = catalog.tasks.some((task) => (
    task.source === 'team'
    && ['pending', 'ready', 'running', 'waiting', 'cancelling', 'summarizing'].includes(task.status)
  ));

  useEffect(() => {
    if (!shouldPoll) return undefined;

    const interval = window.setInterval(() => {
      void load({ silent: true });
    }, 2000);

    return () => window.clearInterval(interval);
  }, [load, shouldPoll]);

  return { catalog, loading, error, refresh: load };
}

function TeamApprovalBadge({ status }: { status: TeamPlanApprovalStatus }) {
  const { t } = useTranslation();
  const labelKey = {
    pending: 'team.approval.pending',
    approved: 'team.approval.approved',
    rejected: 'team.approval.rejected',
  } as const;

  return (
    <Badge className={cn('border font-medium', TEAM_APPROVAL_CLASSNAME[status])}>
      {t(labelKey[status])}
    </Badge>
  );
}

function TeamRunStatusBadge({ status }: { status: TeamRunStatus }) {
  const { t } = useTranslation();
  const labelKey = {
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

  return (
    <Badge className={cn('border font-medium', TEAM_RUN_STATUS_CLASSNAME[status])}>
      {t(labelKey[status])}
    </Badge>
  );
}

function ManualTaskStatusBadge({ status }: { status: TaskStatus }) {
  const { t } = useTranslation();
  const labelKey = {
    pending: 'taskHub.status.pending',
    in_progress: 'taskHub.status.inProgress',
    completed: 'taskHub.status.completed',
    failed: 'taskHub.status.failed',
  } as const;

  return (
    <Badge className={cn('border font-medium', MANUAL_TASK_STATUS_CLASSNAME[status])}>
      {t(labelKey[status])}
    </Badge>
  );
}

function RoleKindBadge({ roleKind }: { roleKind: TeamAgentPresetRoleKind }) {
  const { t } = useTranslation();
  return (
    <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.14em]">
      {t(ROLE_KIND_LABEL_KEY[roleKind])}
    </Badge>
  );
}

function TeamHubShell({
  title,
  description,
  loading,
  error,
  onRefresh,
  children,
}: {
  title: string;
  description: string;
  loading: boolean;
  error: string;
  onRefresh: () => void | Promise<void>;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void onRefresh()} disabled={loading}>
            {t('common.refresh')}
          </Button>
          <Button asChild>
            <Link href="/main-agent">{t('teamHub.openMainAgent')}</Link>
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-border/60 bg-card px-4 py-6 text-sm text-muted-foreground">
          {t('common.loading')}
        </div>
      ) : children}
    </div>
  );
}

function TeamCard({ team }: { team: TeamDirectoryItem }) {
  const { t } = useTranslation();
  const projectLabel = team.projectName || t('chatList.noProject');
  const previewRoles = team.roles.slice(0, 4);

  return (
    <Card className="gap-0 overflow-hidden border-border/70 bg-card/95 py-0 shadow-[0_12px_40px_-24px_rgba(15,23,42,0.18)]">
      <CardHeader className="border-b border-border/50 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{team.title}</CardTitle>
          <TeamApprovalBadge status={team.approvalStatus} />
          <TeamRunStatusBadge status={team.runStatus} />
        </div>
        <CardDescription className="text-sm">{team.summary}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 px-5 py-5">
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>{t('teamHub.createdScenario')}: {team.createdScenario}</p>
          <p>{t('teamHub.currentStage')}: {team.currentStage || t('teamHub.currentStageNone')}</p>
          <p>{t('teamHub.executor')}: {team.currentExecutorName || team.executorLabel}</p>
          <p>{t('teamHub.progress')}: {team.completedTaskCount}/{team.taskCount}</p>
          <p>{t('teamHub.linkedTask')}: {t('teamHub.linkedTaskValue', { value: team.summary })}</p>
          <p>{t('teamHub.project')}: {projectLabel}</p>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamHub.roles')}</p>
          <div className="flex flex-wrap gap-2">
            {previewRoles.map((role) => (
              <Badge key={role.id} variant="outline">{role.name}</Badge>
            ))}
            {team.roles.length > previewRoles.length ? (
              <Badge variant="outline">{t('teamHub.moreRoles', { value: team.roles.length - previewRoles.length })}</Badge>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border border-border/50 bg-muted/[0.08] px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamHub.outputs')}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
            {team.latestOutput || team.outputs[0] || t('teamHub.latestOutputNone')}
          </p>
        </div>

        {team.blockedReason ? (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-rose-700 dark:text-rose-300">{t('teamHub.blockedReason')}</p>
            <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">{team.blockedReason}</p>
          </div>
        ) : null}

        {team.finalSummary ? (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamHub.finalSummary')}</p>
            <p className="whitespace-pre-wrap text-sm text-foreground">{team.finalSummary}</p>
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="justify-between border-t border-border/50 py-4">
        <span className="text-xs text-muted-foreground">
          {t('teamHub.updatedAt')}: {formatTimestamp(team.updatedAt)}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={team.teamPath}>{t('teamHub.openTeam')}</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={team.relatedTaskPath}>{t('teamHub.openTask')}</Link>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

function TaskCard({ task }: { task: TaskDirectoryItem }) {
  const { t } = useTranslation();
  const projectLabel = task.projectName || t('chatList.noProject');
  const summary = task.summary.trim() || t('taskHub.noSummary');

  return (
    <Card className="gap-0 overflow-hidden border-border/70 bg-card/95 py-0 shadow-[0_12px_40px_-24px_rgba(15,23,42,0.18)]">
      <CardHeader className="border-b border-border/50 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{task.title}</CardTitle>
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.14em]">
            {task.source === 'team' ? t('taskHub.source.team') : t('taskHub.source.manual')}
          </Badge>
          {task.source === 'team' ? (
            <TeamRunStatusBadge status={task.status as TeamRunStatus} />
          ) : (
            <ManualTaskStatusBadge status={task.status as TaskStatus} />
          )}
        </div>
        <CardDescription>{task.sessionTitle}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 px-5 py-5">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('taskHub.summary')}</p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{summary}</p>
        </div>

        <div className="space-y-2 text-sm text-muted-foreground">
          <p>{t('taskHub.createdScenario')}: {task.createdScenario}</p>
          <p>{t('taskHub.executor')}: {task.currentExecutorName || task.executorLabel}</p>
          <p>{t('taskHub.progress')}: {task.progressCompleted}/{task.progressTotal}</p>
          <p>{t('taskHub.currentStage')}: {task.currentStage || t('taskHub.currentStageNone')}</p>
          <p>{t('taskHub.project')}: {projectLabel}</p>
          {task.teamTitle ? <p>{t('taskHub.parentTeam')}: {task.teamTitle}</p> : null}
        </div>

        {task.expectedOutput ? (
          <p className="text-sm text-muted-foreground">{t('taskHub.expectedOutput')}: {task.expectedOutput}</p>
        ) : null}

        <div className="rounded-2xl border border-border/50 bg-muted/[0.08] px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('taskHub.outputs')}</p>
          <p className="mt-2 text-sm text-foreground">
            {task.latestOutput || task.outputs[0] || t('taskHub.outputsNone')}
          </p>
        </div>
      </CardContent>

      <CardFooter className="justify-between border-t border-border/50 py-4">
        <span className="text-xs text-muted-foreground">{t('taskHub.updatedAt')}: {formatTimestamp(task.updatedAt)}</span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={task.taskPath}>{t('taskHub.openTask')}</Link>
          </Button>
          {task.teamId ? (
            <Button variant="outline" size="sm" asChild>
              <Link href={`/team/${task.teamId}`}>{t('taskHub.openTeam')}</Link>
            </Button>
          ) : null}
          <Button size="sm" asChild>
            <Link href={`/main-agent/${task.sessionId}`}>{t('taskHub.openSession')}</Link>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

function AgentPresetCard({
  preset,
  onEdit,
  onDelete,
}: {
  preset: AgentPresetDirectoryItem;
  onEdit: (preset: AgentPresetDirectoryItem) => void;
  onDelete: (preset: AgentPresetDirectoryItem) => void;
}) {
  const { t } = useTranslation();

  return (
    <Card className="gap-4 py-0">
      <CardHeader className="border-b border-border/60 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{preset.name}</CardTitle>
          <RoleKindBadge roleKind={preset.roleKind} />
        </div>
        <CardDescription>{preset.description || preset.responsibility}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamHub.agents.responsibility')}</p>
          <p className="text-sm text-foreground">{preset.responsibility}</p>
        </div>

        {preset.collaborationStyle ? (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamHub.agents.collaborationStyle')}</p>
            <p className="text-sm text-foreground">{preset.collaborationStyle}</p>
          </div>
        ) : null}

        {preset.outputContract ? (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamHub.agents.outputContract')}</p>
            <p className="text-sm text-foreground">{preset.outputContract}</p>
          </div>
        ) : null}

        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamHub.agents.systemPrompt')}</p>
          <p className="whitespace-pre-wrap rounded-xl border border-border/60 bg-muted/15 px-3 py-3 text-sm text-foreground">
            {preset.systemPrompt}
          </p>
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 py-4">
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>{t('teamHub.agents.linkedTemplates')}: {preset.templateCount}</p>
          <p>{t('teamHub.agents.updatedAt')}: {formatTimestamp(preset.updatedAt)}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onEdit(preset)}>
            {t('common.edit')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onDelete(preset)}>
            {t('common.delete')}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

function TeamTemplateCard({
  template,
  onEdit,
  onDelete,
}: {
  template: TeamTemplateDirectoryItem;
  onEdit: (template: TeamTemplateDirectoryItem) => void;
  onDelete: (template: TeamTemplateDirectoryItem) => void;
}) {
  const { t } = useTranslation();

  return (
    <Card className="gap-4 py-0">
      <CardHeader className="border-b border-border/60 py-5">
        <CardTitle className="text-base">{template.name}</CardTitle>
        <CardDescription>{template.summary}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamHub.templates.agents')}</p>
          <div className="flex flex-wrap gap-2">
            {template.agentPresetNames.map((name) => (
              <Badge key={name} variant="outline">{name}</Badge>
            ))}
          </div>
        </div>

        {template.activationHint ? (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamHub.templates.activationHint')}</p>
            <p className="text-sm text-foreground">{template.activationHint}</p>
          </div>
        ) : null}

        {template.defaultGoal ? (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamHub.templates.defaultGoal')}</p>
            <p className="text-sm text-foreground">{template.defaultGoal}</p>
          </div>
        ) : null}

        {template.defaultOutcome ? (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamHub.templates.defaultOutcome')}</p>
            <p className="text-sm text-foreground">{template.defaultOutcome}</p>
          </div>
        ) : null}

        {template.notes ? (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('teamHub.templates.notes')}</p>
            <p className="whitespace-pre-wrap rounded-xl border border-border/60 bg-muted/15 px-3 py-3 text-sm text-foreground">
              {template.notes}
            </p>
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 py-4">
        <span className="text-xs text-muted-foreground">
          {t('teamHub.templates.updatedAt')}: {formatTimestamp(template.updatedAt)}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onEdit(template)}>
            {t('common.edit')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onDelete(template)}>
            {t('common.delete')}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

function AgentPresetDialog({
  open,
  initialValue,
  busy,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  initialValue: AgentPresetDirectoryItem | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: CreateAgentPresetRequest) => Promise<string | null>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<AgentPresetFormState>(createEmptyAgentForm());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setError('');
      if (!initialValue) {
        setForm(createEmptyAgentForm());
        return;
      }
      setForm({
        name: initialValue.name,
        roleKind: initialValue.roleKind,
        responsibility: initialValue.responsibility,
        systemPrompt: initialValue.systemPrompt,
        description: initialValue.description || '',
        collaborationStyle: initialValue.collaborationStyle || '',
        outputContract: initialValue.outputContract || '',
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [initialValue, open]);

  const handleSubmit = useCallback(async () => {
    const nextError = await onSave({
      name: form.name,
      roleKind: form.roleKind,
      responsibility: form.responsibility,
      systemPrompt: form.systemPrompt,
      description: form.description,
      collaborationStyle: form.collaborationStyle,
      outputContract: form.outputContract,
    });
    setError(nextError || '');
    if (!nextError) {
      onOpenChange(false);
    }
  }, [form, onOpenChange, onSave]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initialValue ? t('teamHub.agents.dialogEditTitle') : t('teamHub.agents.dialogCreateTitle')}</DialogTitle>
          <DialogDescription>{t('teamHub.agents.dialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2 md:grid-cols-[1fr_220px] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="agent-name">{t('teamHub.agents.name')}</Label>
              <Input
                id="agent-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder={t('teamHub.agents.namePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('teamHub.agents.roleKind')}</Label>
              <Select
                value={form.roleKind}
                onValueChange={(value) => setForm((current) => ({ ...current, roleKind: value as TeamAgentPresetRoleKind }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="orchestrator">{t('team.role.orchestrator')}</SelectItem>
                  <SelectItem value="lead">{t('team.role.lead')}</SelectItem>
                  <SelectItem value="worker">{t('team.role.worker')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-description">{t('teamHub.agents.descriptionField')}</Label>
            <Textarea
              id="agent-description"
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              placeholder={t('teamHub.agents.descriptionPlaceholder')}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-responsibility">{t('teamHub.agents.responsibilityField')}</Label>
            <Textarea
              id="agent-responsibility"
              value={form.responsibility}
              onChange={(event) => setForm((current) => ({ ...current, responsibility: event.target.value }))}
              placeholder={t('teamHub.agents.responsibilityPlaceholder')}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-collaboration">{t('teamHub.agents.collaborationStyleField')}</Label>
            <Textarea
              id="agent-collaboration"
              value={form.collaborationStyle}
              onChange={(event) => setForm((current) => ({ ...current, collaborationStyle: event.target.value }))}
              placeholder={t('teamHub.agents.collaborationStylePlaceholder')}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-output">{t('teamHub.agents.outputContractField')}</Label>
            <Textarea
              id="agent-output"
              value={form.outputContract}
              onChange={(event) => setForm((current) => ({ ...current, outputContract: event.target.value }))}
              placeholder={t('teamHub.agents.outputContractPlaceholder')}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="agent-system-prompt">{t('teamHub.agents.systemPromptField')}</Label>
              <span className="text-xs text-muted-foreground">{t('teamHub.agents.promptHint')}</span>
            </div>
            <Textarea
              id="agent-system-prompt"
              value={form.systemPrompt}
              onChange={(event) => setForm((current) => ({ ...current, systemPrompt: event.target.value }))}
              placeholder={t('teamHub.agents.systemPromptPlaceholder')}
              rows={8}
            />
          </div>

          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={busy}>
            {initialValue ? t('teamHub.agents.saveUpdate') : t('teamHub.agents.saveCreate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TeamTemplateDialog({
  open,
  initialValue,
  agentPresets,
  busy,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  initialValue: TeamTemplateDirectoryItem | null;
  agentPresets: AgentPresetDirectoryItem[];
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: CreateTeamTemplateRequest) => Promise<string | null>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<TeamTemplateFormState>(createEmptyTemplateForm());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setError('');
      if (!initialValue) {
        setForm(createEmptyTemplateForm());
        return;
      }
      setForm({
        name: initialValue.name,
        summary: initialValue.summary,
        activationHint: initialValue.activationHint || '',
        defaultGoal: initialValue.defaultGoal || '',
        defaultOutcome: initialValue.defaultOutcome || '',
        notes: initialValue.notes || '',
        agentPresetIds: initialValue.agentPresetIds,
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [initialValue, open]);

  const toggleAgent = useCallback((agentPresetId: string, checked: boolean) => {
    setForm((current) => ({
      ...current,
      agentPresetIds: checked
        ? Array.from(new Set([...current.agentPresetIds, agentPresetId]))
        : current.agentPresetIds.filter((item) => item !== agentPresetId),
    }));
  }, []);

  const handleSubmit = useCallback(async () => {
    const nextError = await onSave({
      name: form.name,
      summary: form.summary,
      activationHint: form.activationHint,
      defaultGoal: form.defaultGoal,
      defaultOutcome: form.defaultOutcome,
      notes: form.notes,
      agentPresetIds: form.agentPresetIds,
    });
    setError(nextError || '');
    if (!nextError) {
      onOpenChange(false);
    }
  }, [form, onOpenChange, onSave]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{initialValue ? t('teamHub.templates.dialogEditTitle') : t('teamHub.templates.dialogCreateTitle')}</DialogTitle>
          <DialogDescription>{t('teamHub.templates.dialogDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="template-name">{t('teamHub.templates.name')}</Label>
            <Input
              id="template-name"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder={t('teamHub.templates.namePlaceholder')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-summary">{t('teamHub.templates.summaryField')}</Label>
            <Textarea
              id="template-summary"
              value={form.summary}
              onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))}
              placeholder={t('teamHub.templates.summaryPlaceholder')}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>{t('teamHub.templates.selectAgents')}</Label>
            {agentPresets.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-4 text-sm text-muted-foreground">
                {t('teamHub.templates.requiresAgents')}
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {agentPresets.map((preset) => {
                  const checked = form.agentPresetIds.includes(preset.id);
                  return (
                    <label
                      key={preset.id}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 transition-colors',
                        checked ? 'border-primary/35 bg-primary/[0.06]' : 'border-border/60 bg-muted/10',
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) => toggleAgent(preset.id, value === true)}
                        aria-label={preset.name}
                      />
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{preset.name}</span>
                          <RoleKindBadge roleKind={preset.roleKind} />
                        </div>
                        <p className="text-xs text-muted-foreground">{preset.description || preset.responsibility}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="template-activation">{t('teamHub.templates.activationHintField')}</Label>
              <Textarea
                id="template-activation"
                value={form.activationHint}
                onChange={(event) => setForm((current) => ({ ...current, activationHint: event.target.value }))}
                placeholder={t('teamHub.templates.activationHintPlaceholder')}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-goal">{t('teamHub.templates.defaultGoalField')}</Label>
              <Textarea
                id="template-goal"
                value={form.defaultGoal}
                onChange={(event) => setForm((current) => ({ ...current, defaultGoal: event.target.value }))}
                placeholder={t('teamHub.templates.defaultGoalPlaceholder')}
                rows={3}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-outcome">{t('teamHub.templates.defaultOutcomeField')}</Label>
            <Textarea
              id="template-outcome"
              value={form.defaultOutcome}
              onChange={(event) => setForm((current) => ({ ...current, defaultOutcome: event.target.value }))}
              placeholder={t('teamHub.templates.defaultOutcomePlaceholder')}
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-notes">{t('teamHub.templates.notesField')}</Label>
            <Textarea
              id="template-notes"
              value={form.notes}
              onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              placeholder={t('teamHub.templates.notesPlaceholder')}
              rows={5}
            />
          </div>

          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={busy || agentPresets.length === 0}>
            {initialValue ? t('teamHub.templates.saveUpdate') : t('teamHub.templates.saveCreate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TeamHubView() {
  const { t } = useTranslation();
  const { catalog, loading, error, refresh } = useMainAgentCatalog();

  return (
    <TeamHubShell
      title={t('teamHub.title')}
      description={t('teamHub.description')}
      loading={loading}
      error={error}
      onRefresh={refresh}
    >
      <Card className="border-border/60 bg-muted/[0.06]">
        <CardContent className="px-5 py-5 text-sm text-muted-foreground">
          {t('teamHub.runsHint')}
        </CardContent>
      </Card>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">{t('teamHub.runsTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('teamHub.runsDescription')}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/team/settings">{t('teamHub.openSettings')}</Link>
            </Button>
          </div>
        </div>

        {catalog.teams.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('teamHub.empty')}</CardTitle>
              <CardDescription>{t('teamHub.emptyHint')}</CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="space-y-4">
            {catalog.teams.map((team) => (
              <TeamCard key={team.id} team={team} />
            ))}
          </div>
        )}
      </section>
    </TeamHubShell>
  );
}

export function TaskHubView() {
  const { t } = useTranslation();
  const { catalog, loading, error, refresh } = useMainAgentCatalog();

  return (
    <TeamHubShell
      title={t('taskHub.title')}
      description={t('taskHub.description')}
      loading={loading}
      error={error}
      onRefresh={refresh}
    >
      {catalog.tasks.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('taskHub.empty')}</CardTitle>
            <CardDescription>{t('taskHub.emptyHint')}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <Card className="border-border/60 bg-muted/10">
            <CardContent className="px-5 py-5 text-sm text-muted-foreground">
              {t('taskHub.structureHint')}
            </CardContent>
          </Card>

          <div className="space-y-4">
            {catalog.tasks.map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </>
      )}
    </TeamHubShell>
  );
}

export function TeamSettingsView() {
  const { t } = useTranslation();
  const { catalog, loading, error, refresh } = useMainAgentCatalog();
  const [agentDialogOpen, setAgentDialogOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentPresetDirectoryItem | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<TeamTemplateDirectoryItem | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const [actionError, setActionError] = useState('');

  const saveAgentPreset = useCallback(async (value: CreateAgentPresetRequest) => {
    setActionError('');
    setBusyKey(editingAgent ? `agent:${editingAgent.id}` : 'agent:new');
    try {
      const response = await fetch(
        editingAgent ? `/api/tasks/agents/${editingAgent.id}` : '/api/tasks/agents',
        {
          method: editingAgent ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return data?.error || t('teamHub.agents.saveFailed');
      }

      setEditingAgent(null);
      await refresh();
      return null;
    } catch {
      return t('teamHub.agents.saveFailed');
    } finally {
      setBusyKey('');
    }
  }, [editingAgent, refresh, t]);

  const saveTeamTemplate = useCallback(async (value: CreateTeamTemplateRequest) => {
    setActionError('');
    setBusyKey(editingTemplate ? `template:${editingTemplate.id}` : 'template:new');
    try {
      const response = await fetch(
        editingTemplate ? `/api/tasks/team-templates/${editingTemplate.id}` : '/api/tasks/team-templates',
        {
          method: editingTemplate ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return data?.error || t('teamHub.templates.saveFailed');
      }

      setEditingTemplate(null);
      await refresh();
      return null;
    } catch {
      return t('teamHub.templates.saveFailed');
    } finally {
      setBusyKey('');
    }
  }, [editingTemplate, refresh, t]);

  const deleteAgentPreset = useCallback(async (preset: AgentPresetDirectoryItem) => {
    setActionError('');
    if (!window.confirm(t('teamHub.agents.deleteConfirm', { value: preset.name }))) {
      return;
    }

    setBusyKey(`agent-delete:${preset.id}`);
    try {
      const response = await fetch(`/api/tasks/agents/${preset.id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setActionError(data?.error || t('teamHub.agents.deleteFailed'));
        return;
      }
      await refresh();
    } catch {
      setActionError(t('teamHub.agents.deleteFailed'));
    } finally {
      setBusyKey('');
    }
  }, [refresh, t]);

  const deleteTeamTemplate = useCallback(async (template: TeamTemplateDirectoryItem) => {
    setActionError('');
    if (!window.confirm(t('teamHub.templates.deleteConfirm', { value: template.name }))) {
      return;
    }

    setBusyKey(`template-delete:${template.id}`);
    try {
      const response = await fetch(`/api/tasks/team-templates/${template.id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setActionError(data?.error || t('teamHub.templates.deleteFailed'));
        return;
      }
      await refresh();
    } catch {
      setActionError(t('teamHub.templates.deleteFailed'));
    } finally {
      setBusyKey('');
    }
  }, [refresh, t]);

  return (
    <>
      <TeamHubShell
        title={t('teamSettings.title')}
        description={t('teamSettings.description')}
        loading={loading}
        error={error}
        onRefresh={refresh}
      >
        {actionError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {actionError}
          </div>
        ) : null}

        <div className="flex items-center justify-end">
          <Button variant="outline" size="sm" asChild>
            <Link href="/team">{t('teamSettings.backToTeams')}</Link>
          </Button>
        </div>

        <Tabs defaultValue="agents">
          <TabsList variant="line" className="w-full justify-start">
            <TabsTrigger value="agents">{t('teamHub.tabs.agents')}</TabsTrigger>
            <TabsTrigger value="templates">{t('teamHub.tabs.templates')}</TabsTrigger>
          </TabsList>

          <TabsContent value="agents" className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-foreground">{t('teamHub.agents.title')}</h2>
                <p className="max-w-3xl text-sm text-muted-foreground">{t('teamHub.agents.description')}</p>
              </div>
              <Button
                onClick={() => {
                  setEditingAgent(null);
                  setAgentDialogOpen(true);
                }}
                disabled={busyKey !== ''}
              >
                {t('teamHub.agents.create')}
              </Button>
            </div>

            {catalog.agentPresets.length === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('teamHub.agents.empty')}</CardTitle>
                  <CardDescription>{t('teamHub.agents.emptyHint')}</CardDescription>
                </CardHeader>
              </Card>
            ) : (
              <div className="space-y-4">
                {catalog.agentPresets.map((preset) => (
                  <AgentPresetCard
                    key={preset.id}
                    preset={preset}
                    onEdit={(value) => {
                      setEditingAgent(value);
                      setAgentDialogOpen(true);
                    }}
                    onDelete={(value) => void deleteAgentPreset(value)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="templates" className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-foreground">{t('teamHub.templates.title')}</h2>
                <p className="max-w-3xl text-sm text-muted-foreground">{t('teamHub.templates.description')}</p>
              </div>
              <Button
                onClick={() => {
                  setEditingTemplate(null);
                  setTemplateDialogOpen(true);
                }}
                disabled={busyKey !== '' || catalog.agentPresets.length === 0}
              >
                {t('teamHub.templates.create')}
              </Button>
            </div>

            {catalog.teamTemplates.length === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('teamHub.templates.empty')}</CardTitle>
                  <CardDescription>{t('teamHub.templates.emptyHint')}</CardDescription>
                </CardHeader>
              </Card>
            ) : (
              <div className="space-y-4">
                {catalog.teamTemplates.map((template) => (
                  <TeamTemplateCard
                    key={template.id}
                    template={template}
                    onEdit={(value) => {
                      setEditingTemplate(value);
                      setTemplateDialogOpen(true);
                    }}
                    onDelete={(value) => void deleteTeamTemplate(value)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </TeamHubShell>

      <AgentPresetDialog
        open={agentDialogOpen}
        initialValue={editingAgent}
        busy={busyKey.startsWith('agent:')}
        onOpenChange={(open) => {
          setAgentDialogOpen(open);
          if (!open) {
            setEditingAgent(null);
          }
        }}
        onSave={saveAgentPreset}
      />

      <TeamTemplateDialog
        open={templateDialogOpen}
        initialValue={editingTemplate}
        agentPresets={catalog.agentPresets}
        busy={busyKey.startsWith('template:')}
        onOpenChange={(open) => {
          setTemplateDialogOpen(open);
          if (!open) {
            setEditingTemplate(null);
          }
        }}
        onSave={saveTeamTemplate}
      />
    </>
  );
}
