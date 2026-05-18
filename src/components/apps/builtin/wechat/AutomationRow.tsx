'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bell, ExternalLink, Loader2, Play, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { kindLabel } from './automation-schedule-form';
import { runStatusClass, runStatusLabel } from './automation-format';
import { formatDateTime } from './wechat-types';
import type { Automation, Followup } from './relations-types';

export function AutomationRow({
  automation,
  followups,
  triggering,
  triggerBlocked,
  onToggle,
  onEdit,
  onDelete,
  onTrigger,
}: {
  automation: Automation;
  followups: Followup[];
  triggering: boolean;
  triggerBlocked: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onTrigger: () => void;
}): React.ReactElement {
  const linkedFollowup = automation.followupId
    ? followups.find((f) => f.id === automation.followupId) ?? null
    : null;
  const runnable = Boolean(automation.scheduleId && !automation.scheduleError);

  return (
    <Card className={cn('transition-all hover:ring-1 hover:ring-foreground/15', !automation.enabled && 'opacity-60')}>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div
              className={cn(
                'mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors',
                automation.enabled
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              <Bell className="size-4" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{automation.name}</p>
              <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[11px] text-muted-foreground">
                <span>{kindLabel(automation.kind)}</span>
                <span>· {automation.cronLabel}</span>
                {linkedFollowup ? <span>· 跟进 「{linkedFollowup.title}」</span> : null}
                {automation.scheduleError ? (
                  <span className="text-amber-600">· 仅保存规则</span>
                ) : automation.scheduleId ? (
                  <span className="text-emerald-600">· 已接入调度</span>
                ) : null}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={automation.enabled} onCheckedChange={onToggle} />
            {runnable ? (
              <>
                {/* 已停用(开关 off)不给「立即运行」——卡片已灰掉示意停止，
                    再放一键真跑与"已关闭"语义矛盾。历史「记录」仍可看。 */}
                {automation.enabled ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onTrigger}
                    disabled={triggering || triggerBlocked}
                    title={triggerBlocked ? '已有自动化正在触发，请稍后再试' : undefined}
                    className="h-7 px-2 text-xs"
                  >
                    {triggering ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                    {triggerBlocked ? '等待中' : '立即运行'}
                  </Button>
                ) : null}
                <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                  <Link href={`/workflow/schedules/${automation.scheduleId}`}>
                    <ExternalLink className="size-3.5" />
                    记录
                  </Link>
                </Button>
              </>
            ) : null}
            <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 px-2 text-xs">
              编辑
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-rose-600"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground tabular-nums">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              {automation.scheduleError
                ? automation.scheduleError
                : automation.lastRunAt
                  ? `上次 ${formatDateTime(automation.lastRunAt)}`
                  : '尚未触发'}
            </span>
            {automation.lastRunStatus ? (
              <span className={cn('rounded-full px-2 py-0.5', runStatusClass(automation.lastRunStatus))}>
                {runStatusLabel(automation.lastRunStatus)}
              </span>
            ) : null}
            {automation.latestRunId && automation.scheduleId ? (
              <Link
                href={`/workflow/schedules/${automation.scheduleId}/runs/${automation.latestRunId}`}
                className="inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline"
              >
                最新结果
                <ExternalLink className="size-3" />
              </Link>
            ) : null}
            {automation.lastRunError ? (
              <span className="max-w-full truncate text-destructive">{automation.lastRunError}</span>
            ) : null}
          </div>
          <span className="shrink-0">
            {automation.nextRunAt ? `下次 ${formatDateTime(automation.nextRunAt)}` : ''}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
