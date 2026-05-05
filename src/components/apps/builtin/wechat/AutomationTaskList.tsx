'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { formatDateTime, type BuiltinTask } from './wechat-types';

const SCHEDULE_OPTIONS = ['09:00', '12:00', '18:00', '21:00', '实时'];

export function AutomationTaskList({
  tasks,
  busyId,
  analysisLoading,
  onUpdate,
  onRunSummary,
}: {
  tasks: BuiltinTask[];
  busyId: string | null;
  analysisLoading: boolean;
  onUpdate: (task: BuiltinTask, patch: Partial<Pick<BuiltinTask, 'enabled' | 'schedule'>>) => void;
  onRunSummary: () => void;
}): React.ReactElement {
  const enabledCount = tasks.filter((t) => t.enabled).length;
  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between gap-3 space-y-0">
        <CardTitle className="flex items-baseline gap-2 text-base font-semibold tracking-tight">
          内置任务
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {enabledCount}/{tasks.length}
          </span>
        </CardTitle>
        <Button onClick={onRunSummary} disabled={analysisLoading} size="sm" variant="outline">
          {analysisLoading ? '运行中' : '立即运行'}
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-col">
          {tasks.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              busy={busyId === task.id}
              onUpdate={onUpdate}
              first={index === 0}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TaskRow({
  task,
  busy,
  onUpdate,
  first,
}: {
  task: BuiltinTask;
  busy: boolean;
  onUpdate: (task: BuiltinTask, patch: Partial<Pick<BuiltinTask, 'enabled' | 'schedule'>>) => void;
  first: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-2.5 py-4', !first && 'border-t')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className={cn(
              'mt-2 inline-block size-1.5 shrink-0 rounded-full',
              task.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/30',
            )}
          />
          <div className="min-w-0">
            <p className="text-sm font-medium leading-6">{task.title}</p>
            <p className="text-xs text-muted-foreground">{task.description}</p>
          </div>
        </div>
        <Switch
          checked={task.enabled}
          disabled={busy}
          onCheckedChange={(enabled) => onUpdate(task, { enabled })}
          aria-label={`启用 ${task.title}`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {SCHEDULE_OPTIONS.map((time) => {
          const active = task.schedule === time;
          return (
            <button
              key={time}
              type="button"
              disabled={busy}
              onClick={() => onUpdate(task, { schedule: time })}
              className={cn(
                'rounded-md border px-2 py-0.5 text-[11px] tabular-nums transition-colors',
                active
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                busy && 'opacity-60',
              )}
            >
              {time}
            </button>
          );
        })}
      </div>
      {task.lastResult || task.lastRunAt ? (
        <div className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
          <p className="break-words leading-5">{task.lastResult}</p>
          {task.lastRunAt ? (
            <p className="tabular-nums">最近 {formatDateTime(task.lastRunAt)}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">尚未运行</p>
      )}
    </div>
  );
}
