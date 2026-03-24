'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type WorkflowConfigurableAgentRole =
  | 'scheduling'
  | 'worker'
  | 'researcher'
  | 'coder'
  | 'integration';

interface WorkflowAgentRoleProfile {
  role: WorkflowConfigurableAgentRole;
  title: string;
  shortLabel: string;
  scope: 'planning' | 'execution';
  implementationStatus: 'live' | 'partial';
  description: string;
  roleName: string;
  agentType: string;
  systemPrompt: string;
  defaultSystemPrompt: string;
  hasOverrides: boolean;
  notes: string[];
  tools: string[];
  defaultTools: string[];
  editableToolOptions: string[];
  capabilityTags: string[];
  memoryPolicy?: string;
  concurrencyLimit?: number;
  defaultConcurrencyLimit?: number;
  plannerTimeoutMs?: number;
  defaultPlannerTimeoutMs?: number;
  plannerMaxRetries?: number;
  defaultPlannerMaxRetries?: number;
}

interface WorkflowAgentRoleFormState {
  systemPrompt: string;
  allowedTools: string[];
  concurrencyLimit: string;
  plannerTimeoutMs: string;
  plannerMaxRetries: string;
}

interface WorkflowAgentRuntimeSession {
  workflowRunId: string;
  stepId: string;
  startedAt: string;
  lifecycleState: 'preparing' | 'running';
  cancelRequested: boolean;
  role: WorkflowConfigurableAgentRole;
  roleName: string;
  agentType: string;
  executionMode: 'claude' | 'synthetic';
  requestedModel?: string;
  allowedTools: string[];
  capabilityTags: string[];
  memoryPolicy?: string;
  concurrencyLimit?: number;
  sessionId?: string;
  runId?: string;
  stageId?: string;
  memoryRefs?: {
    taskMemoryId?: string;
    plannerMemoryId?: string;
    agentMemoryId?: string;
  };
  workspace?: {
    sessionWorkspace?: string;
    runWorkspace?: string;
    stageWorkspace?: string;
    sharedReadDir?: string;
    artifactOutputDir?: string;
  };
}

const SCOPE_CLASSNAME: Record<WorkflowAgentRoleProfile['scope'], string> = {
  planning: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  execution: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
};

const RUNTIME_STATE_CLASSNAME: Record<WorkflowAgentRuntimeSession['lifecycleState'], string> = {
  preparing: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  running: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
};

function formatRuntimeDate(value?: string): string {
  if (!value) {
    return '未提供';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function getRuntimeExecutionModeLabel(value: WorkflowAgentRuntimeSession['executionMode']): string {
  return value === 'claude' ? 'Claude 真实执行' : '模拟执行';
}

function createFormState(role: WorkflowAgentRoleProfile | null): WorkflowAgentRoleFormState {
  if (!role) {
    return {
      systemPrompt: '',
      allowedTools: [],
      concurrencyLimit: '',
      plannerTimeoutMs: '',
      plannerMaxRetries: '',
    };
  }

  return {
    systemPrompt: role.systemPrompt,
    allowedTools: [...role.tools],
    concurrencyLimit: typeof role.concurrencyLimit === 'number' ? String(role.concurrencyLimit) : '',
    plannerTimeoutMs: typeof role.plannerTimeoutMs === 'number' ? String(role.plannerTimeoutMs) : '',
    plannerMaxRetries: typeof role.plannerMaxRetries === 'number' ? String(role.plannerMaxRetries) : '',
  };
}

function WorkflowAgentRoleDialog({
  open,
  role,
  busy,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  role: WorkflowAgentRoleProfile | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: WorkflowAgentRoleFormState) => Promise<string | null>;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<WorkflowAgentRoleFormState>(() => createFormState(role));
  const [error, setError] = useState('');

  if (!role) {
    return null;
  }

  const toggleTool = (tool: string, checked: boolean) => {
    setForm((current) => ({
      ...current,
      allowedTools: checked
        ? Array.from(new Set([...current.allowedTools, tool]))
        : current.allowedTools.filter((item) => item !== tool),
    }));
  };

  const handleSubmit = async () => {
    const nextError = await onSave(form);
    setError(nextError || '');
    if (!nextError) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('workflowAgents.dialog.title', { value: role.shortLabel })}</DialogTitle>
          <DialogDescription>{t('workflowAgents.dialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-3 rounded-2xl border border-border/60 bg-muted/10 px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn('border font-medium', SCOPE_CLASSNAME[role.scope])}>
                {role.scope === 'planning'
                  ? t('workflowAgents.scope.planning')
                  : t('workflowAgents.scope.execution')}
              </Badge>
              <Badge variant="outline">{role.roleName}</Badge>
              <Badge variant="outline">{role.agentType}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{role.description}</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="workflow-agent-system-prompt">{t('workflowAgents.fields.systemPrompt')}</Label>
              <span className="text-xs text-muted-foreground">{t('workflowAgents.fields.systemPromptHint')}</span>
            </div>
            <Textarea
              id="workflow-agent-system-prompt"
              value={form.systemPrompt}
              onChange={(event) => setForm((current) => ({ ...current, systemPrompt: event.target.value }))}
              rows={10}
            />
          </div>

          {role.scope === 'planning' ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="workflow-agent-timeout">{t('workflowAgents.fields.plannerTimeout')}</Label>
                <Input
                  id="workflow-agent-timeout"
                  type="number"
                  min={5000}
                  max={120000}
                  step={1000}
                  value={form.plannerTimeoutMs}
                  onChange={(event) => setForm((current) => ({ ...current, plannerTimeoutMs: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="workflow-agent-retries">{t('workflowAgents.fields.plannerRetries')}</Label>
                <Input
                  id="workflow-agent-retries"
                  type="number"
                  min={0}
                  max={5}
                  step={1}
                  value={form.plannerMaxRetries}
                  onChange={(event) => setForm((current) => ({ ...current, plannerMaxRetries: event.target.value }))}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>{t('workflowAgents.fields.allowedTools')}</Label>
                <div className="grid gap-3 rounded-2xl border border-border/60 bg-background/80 px-4 py-4 md:grid-cols-2">
                  {role.editableToolOptions.map((tool) => {
                    const checked = form.allowedTools.includes(tool);
                    return (
                      <label key={tool} className="flex items-start gap-3 text-sm text-foreground">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => toggleTool(tool, value === true)}
                          aria-label={tool}
                        />
                        <div className="space-y-1">
                          <p className="font-medium">{tool}</p>
                          <p className="text-xs text-muted-foreground">{t('workflowAgents.fields.allowedToolsHint')}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="workflow-agent-concurrency">{t('workflowAgents.fields.concurrency')}</Label>
                  <Input
                    id="workflow-agent-concurrency"
                    type="number"
                    min={1}
                    max={10}
                    step={1}
                    value={form.concurrencyLimit}
                    onChange={(event) => setForm((current) => ({ ...current, concurrencyLimit: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('workflowAgents.fields.memoryPolicy')}</Label>
                  <div className="rounded-xl border border-border/60 bg-muted/10 px-4 py-2 text-sm text-muted-foreground">
                    {role.memoryPolicy || t('workflowAgents.memoryPolicy.unset')}
                  </div>
                </div>
              </div>
            </>
          )}

          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('workflowAgents.actions.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={busy}>
            {t('workflowAgents.actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkflowAgentRoleCard({
  role,
  busy,
  onEdit,
  onReset,
}: {
  role: WorkflowAgentRoleProfile;
  busy: boolean;
  onEdit: (role: WorkflowAgentRoleProfile) => void;
  onReset: (role: WorkflowAgentRoleProfile) => void;
}) {
  const { t } = useTranslation();

  return (
    <Card className="border-border/60">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{role.shortLabel}</CardTitle>
              <Badge className={cn('border font-medium', SCOPE_CLASSNAME[role.scope])}>
                {role.scope === 'planning'
                  ? t('workflowAgents.scope.planning')
                  : t('workflowAgents.scope.execution')}
              </Badge>
              <Badge variant="outline">{role.title}</Badge>
              {role.hasOverrides ? (
                <Badge variant="outline">{t('workflowAgents.badges.customized')}</Badge>
              ) : null}
            </div>
            <CardDescription>{role.description}</CardDescription>
          </div>

          <div className="flex items-center gap-2">
            {role.hasOverrides ? (
              <Button variant="outline" size="sm" onClick={() => onReset(role)} disabled={busy}>
                {t('workflowAgents.actions.reset')}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => onEdit(role)} disabled={busy}>
              {t('workflowAgents.actions.edit')}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>{t('workflowAgents.card.roleName')}: {role.roleName}</p>
            <p>{t('workflowAgents.card.agentType')}: {role.agentType}</p>
            {role.scope === 'planning' ? (
              <>
                <p>{t('workflowAgents.card.plannerTimeout')}: {role.plannerTimeoutMs} ms</p>
                <p>{t('workflowAgents.card.plannerRetries')}: {role.plannerMaxRetries}</p>
              </>
            ) : (
              <>
                <p>{t('workflowAgents.card.concurrency')}: {role.concurrencyLimit}</p>
                <p>{t('workflowAgents.card.memoryPolicy')}: {role.memoryPolicy || t('workflowAgents.memoryPolicy.unset')}</p>
              </>
            )}
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t('workflowAgents.card.tools')}
            </p>
            <div className="flex flex-wrap gap-2">
              {role.tools.length === 0 ? (
                <span className="text-sm text-muted-foreground">{t('workflowAgents.card.noTools')}</span>
              ) : (
                role.tools.map((tool) => (
                  <Badge key={tool} variant="outline">
                    {tool}
                  </Badge>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t('workflowAgents.card.systemPrompt')}
          </p>
          <div className="max-h-48 overflow-auto rounded-2xl border border-border/60 bg-muted/10 px-4 py-3">
            <pre className="whitespace-pre-wrap text-sm text-foreground">{role.systemPrompt}</pre>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t('workflowAgents.card.notes')}
          </p>
          <div className="space-y-2">
            {role.notes.map((note, index) => (
              <p key={`${role.role}-note-${index}`} className="text-sm text-muted-foreground">
                {note}
              </p>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function WorkflowAgentSettingsSection({
  variant = 'embedded',
}: {
  variant?: 'embedded' | 'standalone';
}) {
  const { t } = useTranslation();
  const [roles, setRoles] = useState<WorkflowAgentRoleProfile[]>([]);
  const [runtimeSessions, setRuntimeSessions] = useState<WorkflowAgentRuntimeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [error, setError] = useState('');
  const [runtimeError, setRuntimeError] = useState('');
  const [runtimeMessage, setRuntimeMessage] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [runtimeBusyKey, setRuntimeBusyKey] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<WorkflowAgentRoleProfile | null>(null);

  const loadRoles = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) {
      setLoading(true);
      setError('');
    }

    try {
      const response = await fetch('/api/workflow/agents', { cache: 'no-store' });
      const data = await response.json().catch(() => ({ roles: [] }));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load workflow agents');
      }
      setRoles(Array.isArray(data.roles) ? data.roles : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load workflow agents');
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  const loadRuntimeSessions = useCallback(async (options?: { silent?: boolean }) => {
    if (variant !== 'standalone') {
      return;
    }

    const silent = options?.silent === true;
    if (!silent) {
      setRuntimeLoading(true);
    }
    setRuntimeError('');

    try {
      const response = await fetch('/api/workflow/agent-sessions', { cache: 'no-store' });
      const data = await response.json().catch(() => ({ sessions: [] }));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load workflow agent sessions');
      }
      setRuntimeSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (loadError) {
      setRuntimeError(loadError instanceof Error ? loadError.message : 'Failed to load workflow agent sessions');
    } finally {
      if (!silent) {
        setRuntimeLoading(false);
      }
    }
  }, [variant]);

  useEffect(() => {
    if (variant !== 'standalone') {
      return undefined;
    }

    void loadRuntimeSessions();
    const timer = window.setInterval(() => {
      void loadRuntimeSessions({ silent: true });
    }, 5000);

    return () => window.clearInterval(timer);
  }, [loadRuntimeSessions, variant]);

  const stats = useMemo(() => {
    const planningCount = roles.filter((role) => role.scope === 'planning').length;
    const executionCount = roles.filter((role) => role.scope === 'execution').length;
    const customizedCount = roles.filter((role) => role.hasOverrides).length;

    return {
      total: roles.length,
      planningCount,
      executionCount,
      customizedCount,
    };
  }, [roles]);

  const runtimeStats = useMemo(() => {
    const preparingCount = runtimeSessions.filter((session) => session.lifecycleState === 'preparing').length;
    const runningCount = runtimeSessions.filter((session) => session.lifecycleState === 'running').length;
    const cancelRequestedCount = runtimeSessions.filter((session) => session.cancelRequested).length;

    return {
      total: runtimeSessions.length,
      preparingCount,
      runningCount,
      cancelRequestedCount,
    };
  }, [runtimeSessions]);

  const planningRoles = useMemo(
    () => roles.filter((role) => role.scope === 'planning'),
    [roles],
  );
  const executionRoles = useMemo(
    () => roles.filter((role) => role.scope === 'execution'),
    [roles],
  );

  const saveRole = useCallback(async (value: WorkflowAgentRoleFormState) => {
    if (!editingRole) {
      return t('workflowAgents.feedback.saveFailed');
    }

    setBusyKey(`save:${editingRole.role}`);
    try {
      const payload: Record<string, unknown> = {
        systemPrompt: value.systemPrompt.trim(),
      };

      if (editingRole.scope === 'planning') {
        payload.plannerTimeoutMs = Number.parseInt(value.plannerTimeoutMs, 10);
        payload.plannerMaxRetries = Number.parseInt(value.plannerMaxRetries, 10);
      } else {
        payload.allowedTools = value.allowedTools;
        payload.concurrencyLimit = Number.parseInt(value.concurrencyLimit, 10);
      }

      const response = await fetch(`/api/workflow/agents/${editingRole.role}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return data?.error || t('workflowAgents.feedback.saveFailed');
      }

      await loadRoles({ silent: true });
      return null;
    } catch {
      return t('workflowAgents.feedback.saveFailed');
    } finally {
      setBusyKey('');
    }
  }, [editingRole, loadRoles, t]);

  const resetRole = useCallback(async (role: WorkflowAgentRoleProfile) => {
    if (!window.confirm(t('workflowAgents.feedback.resetConfirm', { value: role.shortLabel }))) {
      return;
    }

    setBusyKey(`reset:${role.role}`);
    try {
      const response = await fetch(`/api/workflow/agents/${role.role}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data?.error || t('workflowAgents.feedback.resetFailed'));
        return;
      }
      await loadRoles({ silent: true });
    } catch {
      setError(t('workflowAgents.feedback.resetFailed'));
    } finally {
      setBusyKey('');
    }
  }, [loadRoles, t]);

  const cancelRuntimeSession = useCallback(async (session: WorkflowAgentRuntimeSession) => {
    setRuntimeBusyKey(`${session.workflowRunId}:${session.stepId}`);
    setRuntimeError('');
    setRuntimeMessage('');
    try {
      const response = await fetch('/api/workflow/agent-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowRunId: session.workflowRunId,
          stepId: session.stepId,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRuntimeError(data?.error || t('workflowAgents.runtime.cancelFailed'));
        return;
      }

      setRuntimeMessage(t('workflowAgents.runtime.cancelSuccess', { value: session.stepId }));
      await loadRuntimeSessions({ silent: true });
    } catch {
      setRuntimeError(t('workflowAgents.runtime.cancelFailed'));
    } finally {
      setRuntimeBusyKey('');
    }
  }, [loadRuntimeSessions, t]);

  return (
    <div className="space-y-4">
      {variant === 'standalone' ? (
        <Card className="border-border/60 bg-muted/10">
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border border-violet-500/20 bg-violet-500/10 text-violet-700">
                {t('workflowAgents.entry.badge')}
              </Badge>
              <CardTitle>{t('workflowAgents.entry.title')}</CardTitle>
            </div>
            <CardDescription>{t('workflowAgents.entry.description')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button asChild>
              <Link href="/workflow">{t('workflowAgents.entry.openWorkflow')}</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/team/settings#agents">{t('workflowAgents.entry.openTeamPresets')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/60 bg-muted/10">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">{t('workflowAgents.embedded.title')}</p>
              <p className="text-sm text-muted-foreground">{t('workflowAgents.embedded.description')}</p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/workflow/agents">{t('workflowAgents.embedded.openDedicated')}</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">{t('workflowAgents.title')}</h2>
          <p className="max-w-3xl text-sm text-muted-foreground">{t('workflowAgents.description')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadRoles()} disabled={loading || busyKey !== ''}>
          {t('workflowAgents.actions.refresh')}
        </Button>
      </div>

      <Card className="border-border/60 bg-muted/10">
        <CardHeader>
          <CardTitle>{t('workflowAgents.boundary.title')}</CardTitle>
          <CardDescription>{t('workflowAgents.boundary.description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-4">
            <p className="text-sm font-medium text-foreground">{t('workflowAgents.boundary.teamPresetTitle')}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t('workflowAgents.boundary.teamPresetDescription')}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/80 px-4 py-4">
            <p className="text-sm font-medium text-foreground">{t('workflowAgents.boundary.workflowRoleTitle')}</p>
            <p className="mt-2 text-sm text-muted-foreground">{t('workflowAgents.boundary.workflowRoleDescription')}</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription>{t('workflowAgents.stats.total')}</CardDescription>
            <CardTitle className="text-2xl">{stats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription>{t('workflowAgents.stats.planning')}</CardDescription>
            <CardTitle className="text-2xl">{stats.planningCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription>{t('workflowAgents.stats.execution')}</CardDescription>
            <CardTitle className="text-2xl">{stats.executionCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardDescription>{t('workflowAgents.stats.customized')}</CardDescription>
            <CardTitle className="text-2xl">{stats.customizedCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {variant === 'standalone' ? (
        <Card className="border-border/60">
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <CardTitle>{t('workflowAgents.runtime.title')}</CardTitle>
                <CardDescription>{t('workflowAgents.runtime.description')}</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadRuntimeSessions()}
                disabled={runtimeLoading || runtimeBusyKey !== ''}
              >
                {t('workflowAgents.runtime.refresh')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-3">
                <p className="text-xs text-muted-foreground">{t('workflowAgents.runtime.stats.total')}</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{runtimeStats.total}</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-3">
                <p className="text-xs text-muted-foreground">{t('workflowAgents.runtime.stats.running')}</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{runtimeStats.runningCount}</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-3">
                <p className="text-xs text-muted-foreground">{t('workflowAgents.runtime.stats.preparing')}</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{runtimeStats.preparingCount}</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-3">
                <p className="text-xs text-muted-foreground">{t('workflowAgents.runtime.stats.cancelRequested')}</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{runtimeStats.cancelRequestedCount}</p>
              </div>
            </div>

            {runtimeMessage ? (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700">
                {runtimeMessage}
              </div>
            ) : null}

            {runtimeError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {runtimeError}
              </div>
            ) : null}

            {runtimeLoading && runtimeSessions.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-6 text-sm text-muted-foreground">
                {t('workflowAgents.runtime.loading')}
              </div>
            ) : runtimeSessions.length === 0 ? (
              <div className="rounded-2xl border border-border/60 bg-muted/10 px-4 py-6 text-sm text-muted-foreground">
                {t('workflowAgents.runtime.empty')}
              </div>
            ) : (
              <div className="space-y-4">
                {runtimeSessions.map((session) => {
                  const sessionBusy = runtimeBusyKey === `${session.workflowRunId}:${session.stepId}`;
                  return (
                    <div key={`${session.workflowRunId}:${session.stepId}`} className="rounded-2xl border border-border/60 px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">{session.stepId}</p>
                            <Badge className={cn('border font-medium', RUNTIME_STATE_CLASSNAME[session.lifecycleState])}>
                              {session.lifecycleState === 'running'
                                ? t('workflowAgents.runtime.state.running')
                                : t('workflowAgents.runtime.state.preparing')}
                            </Badge>
                            <Badge variant="outline">{session.roleName}</Badge>
                            <Badge variant="outline">{session.agentType}</Badge>
                            {session.cancelRequested ? (
                              <Badge variant="outline">{t('workflowAgents.runtime.badges.cancelRequested')}</Badge>
                            ) : null}
                          </div>
                          <p className="text-sm text-muted-foreground">{t('workflowAgents.runtime.sessionLabel', { value: session.sessionId || session.workflowRunId })}</p>
                        </div>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void cancelRuntimeSession(session)}
                          disabled={sessionBusy || runtimeBusyKey !== '' || session.cancelRequested}
                        >
                          {sessionBusy
                            ? t('workflowAgents.runtime.actions.cancelling')
                            : t('workflowAgents.runtime.actions.cancel')}
                        </Button>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div className="space-y-1 text-sm text-muted-foreground">
                          <p>{t('workflowAgents.runtime.fields.startedAt')}: {formatRuntimeDate(session.startedAt)}</p>
                          <p>{t('workflowAgents.runtime.fields.executionMode')}: {getRuntimeExecutionModeLabel(session.executionMode)}</p>
                          <p>{t('workflowAgents.runtime.fields.workflowRunId')}: {session.workflowRunId}</p>
                          <p>{t('workflowAgents.runtime.fields.runId')}: {session.runId || t('workflowAgents.runtime.unset')}</p>
                          <p>{t('workflowAgents.runtime.fields.stageId')}: {session.stageId || t('workflowAgents.runtime.unset')}</p>
                          <p>{t('workflowAgents.runtime.fields.requestedModel')}: {session.requestedModel || t('workflowAgents.runtime.unset')}</p>
                          <p>{t('workflowAgents.runtime.fields.concurrencyLimit')}: {session.concurrencyLimit ?? t('workflowAgents.runtime.unset')}</p>
                          <p>{t('workflowAgents.runtime.fields.memoryPolicy')}: {session.memoryPolicy || t('workflowAgents.runtime.unset')}</p>
                        </div>

                        <div className="space-y-1 text-sm text-muted-foreground">
                          <p>{t('workflowAgents.runtime.fields.taskMemory')}: {session.memoryRefs?.taskMemoryId || t('workflowAgents.runtime.unset')}</p>
                          <p>{t('workflowAgents.runtime.fields.plannerMemory')}: {session.memoryRefs?.plannerMemoryId || t('workflowAgents.runtime.unset')}</p>
                          <p>{t('workflowAgents.runtime.fields.agentMemory')}: {session.memoryRefs?.agentMemoryId || t('workflowAgents.runtime.unset')}</p>
                          <p>{t('workflowAgents.runtime.fields.sessionWorkspace')}: {session.workspace?.sessionWorkspace || t('workflowAgents.runtime.unset')}</p>
                          <p>{t('workflowAgents.runtime.fields.runWorkspace')}: {session.workspace?.runWorkspace || t('workflowAgents.runtime.unset')}</p>
                          <p>{t('workflowAgents.runtime.fields.stageWorkspace')}: {session.workspace?.stageWorkspace || t('workflowAgents.runtime.unset')}</p>
                          <p>{t('workflowAgents.runtime.fields.artifactOutputDir')}: {session.workspace?.artifactOutputDir || t('workflowAgents.runtime.unset')}</p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {t('workflowAgents.runtime.fields.tools')}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {session.allowedTools.length > 0 ? session.allowedTools.map((tool) => (
                              <Badge key={`${session.stepId}-${tool}`} variant="outline">
                                {tool}
                              </Badge>
                            )) : (
                              <span className="text-sm text-muted-foreground">{t('workflowAgents.runtime.noTools')}</span>
                            )}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {t('workflowAgents.runtime.fields.capabilities')}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {session.capabilityTags.length > 0 ? session.capabilityTags.map((tag) => (
                              <Badge key={`${session.stepId}-${tag}`} variant="outline">
                                {tag}
                              </Badge>
                            )) : (
                              <span className="text-sm text-muted-foreground">{t('workflowAgents.runtime.noCapabilities')}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('workflowAgents.loading')}</CardTitle>
          </CardHeader>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>{t('workflowAgents.groups.executionTitle')}</CardTitle>
              <CardDescription>{t('workflowAgents.groups.executionDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {executionRoles.map((role) => (
                <WorkflowAgentRoleCard
                  key={role.role}
                  role={role}
                  busy={busyKey !== ''}
                  onEdit={(value) => {
                    setEditingRole(value);
                    setDialogOpen(true);
                  }}
                  onReset={(value) => void resetRole(value)}
                />
              ))}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>{t('workflowAgents.groups.planningTitle')}</CardTitle>
              <CardDescription>{t('workflowAgents.groups.planningDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {planningRoles.map((role) => (
                <WorkflowAgentRoleCard
                  key={role.role}
                  role={role}
                  busy={busyKey !== ''}
                  onEdit={(value) => {
                    setEditingRole(value);
                    setDialogOpen(true);
                  }}
                  onReset={(value) => void resetRole(value)}
                />
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      <WorkflowAgentRoleDialog
        key={`${editingRole?.role ?? 'none'}:${dialogOpen ? 'open' : 'closed'}`}
        open={dialogOpen}
        role={editingRole}
        busy={busyKey.startsWith('save:')}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingRole(null);
          }
        }}
        onSave={saveRole}
      />
    </div>
  );
}
