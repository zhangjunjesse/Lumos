'use client';

import type { TeamPlan, TeamPlanApprovalStatus, TeamPlanRoleKind, TeamRun, TeamRunStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { TranslationKey } from '@/i18n';
import { useTranslation } from '@/hooks/useTranslation';
import { cn } from '@/lib/utils';

interface TeamPlanCardProps {
  plan: TeamPlan;
  run?: TeamRun;
  approvalStatus?: TeamPlanApprovalStatus;
  onApprove?: () => void;
  onReject?: () => void;
  busy?: boolean;
  compact?: boolean;
  title?: string;
  subtitle?: string;
}

const APPROVAL_BADGE_CLASSNAME: Record<TeamPlanApprovalStatus, string> = {
  pending: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  approved: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  rejected: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
};

const APPROVAL_LABEL_KEY: Record<TeamPlanApprovalStatus, TranslationKey> = {
  pending: 'team.approval.pending',
  approved: 'team.approval.approved',
  rejected: 'team.approval.rejected',
};

const RUN_STATUS_CLASSNAME: Record<TeamRunStatus, string> = {
  pending: 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300',
  ready: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  running: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  waiting: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  blocked: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  done: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  failed: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
};

const RUN_STATUS_LABEL_KEY: Record<TeamRunStatus, TranslationKey> = {
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

export function TeamPlanCard({
  plan,
  run,
  approvalStatus = 'pending',
  onApprove,
  onReject,
  busy = false,
  compact = false,
  title,
  subtitle,
}: TeamPlanCardProps) {
  const { t } = useTranslation();
  const roleMap = new Map(plan.roles.map((role) => [role.id, role]));
  const phaseMap = new Map(run?.phases.map((phase) => [phase.planTaskId, phase]) || []);
  const canApprove = approvalStatus === 'pending' && Boolean(onApprove);
  const canReject = approvalStatus === 'pending' && Boolean(onReject);
  const resolvedTitle = title ?? t('team.plan.title');
  const getStatusLabel = (status: TeamRunStatus) => t(RUN_STATUS_LABEL_KEY[status]);

  return (
    <div className="my-2 overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm">
      <div className="border-b border-border/60 bg-muted/30 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{resolvedTitle}</span>
          <Badge className={cn('border font-medium', APPROVAL_BADGE_CLASSNAME[approvalStatus])}>
            {t(APPROVAL_LABEL_KEY[approvalStatus])}
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.14em]">
            {t('team.badge.mainAgent')}
          </Badge>
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.14em]">
            {t('team.badge.teamMode')}
          </Badge>
        </div>
        {subtitle ? (
          <p className="mt-2 text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t('team.plan.summary')}
          </p>
          <p className="text-sm text-foreground">{plan.summary}</p>
          <p className="text-xs text-muted-foreground">
            {t('team.plan.goal', { value: plan.userGoal })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('team.plan.outcome', { value: plan.expectedOutcome })}
          </p>
          {run ? (
            <div className="pt-1">
              <Badge className={cn('border font-medium', RUN_STATUS_CLASSNAME[run.status])}>
                {t('team.plan.run', { status: getStatusLabel(run.status) })}
              </Badge>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t('team.plan.roles')}
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            {plan.roles.map((role) => {
              const parent = role.parentRoleId ? roleMap.get(role.parentRoleId) : null;
              return (
                <div key={role.id} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{role.name}</span>
                    <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-[0.14em]">
                      {t(ROLE_KIND_LABEL_KEY[role.kind])}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{role.responsibility}</p>
                  {parent ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t('team.plan.reportsTo', { value: parent.name })}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t('team.plan.tasks')}
          </p>
          <div className="space-y-2">
            {plan.tasks.map((task, index) => {
              const owner = roleMap.get(task.ownerRoleId);
              const phase = phaseMap.get(task.id);
              return (
                <div key={task.id} className="rounded-xl border border-border/60 bg-background/60 px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="text-sm font-medium text-foreground">{task.title}</span>
                    {owner ? (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {owner.name}
                      </Badge>
                    ) : null}
                    {phase ? (
                      <Badge className={cn('border text-[10px] font-medium', RUN_STATUS_CLASSNAME[phase.status])}>
                        {getStatusLabel(phase.status)}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">{task.summary}</p>
                  <p className="mt-2 text-xs text-foreground/80">
                    {t('team.plan.expectedOutput', { value: task.expectedOutput })}
                  </p>
                  {task.dependsOn.length > 0 ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t('team.plan.dependsOn', { value: task.dependsOn.join(', ') })}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-muted-foreground">{t('team.plan.dependsOnNone')}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {plan.risks && plan.risks.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t('team.plan.risks')}
            </p>
            <div className="flex flex-wrap gap-2">
              {plan.risks.map((risk) => (
                <span
                  key={risk}
                  className="rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground"
                >
                  {risk}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {plan.confirmationPrompt ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            {plan.confirmationPrompt}
          </div>
        ) : null}

        {(canApprove || canReject || !compact) ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            {canReject ? (
              <Button variant="outline" size="sm" onClick={onReject} disabled={busy}>
                {t('team.plan.stayMainAgent')}
              </Button>
            ) : null}
            {canApprove ? (
              <Button size="sm" onClick={onApprove} disabled={busy}>
                {t('team.plan.approve')}
              </Button>
            ) : null}
            {!canApprove && !canReject ? (
              <span className="text-xs text-muted-foreground">
                {t('team.plan.missingExecutionNote')}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
