'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

interface TaskListItem {
  id: string;
  summary: string;
  status: TaskStatus;
  progress?: number;
  createdAt: string;
}

interface ChatTaskRailProps {
  sessionId: string;
}

const STATUS_PRIORITY: Record<TaskStatus, number> = {
  running: 0,
  pending: 1,
  failed: 2,
  completed: 3,
  cancelled: 4,
};

function getStatusClasses(status: TaskStatus): string {
  switch (status) {
    case 'running':
      return 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300';
    case 'pending':
      return 'border-slate-500/25 bg-slate-500/10 text-slate-700 dark:text-slate-300';
    case 'completed':
      return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 'failed':
      return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300';
    case 'cancelled':
      return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300';
    default:
      return 'border-slate-500/25 bg-slate-500/10 text-slate-700 dark:text-slate-300';
  }
}

function getStatusDotClasses(status: TaskStatus): string {
  switch (status) {
    case 'running':
      return 'bg-blue-500';
    case 'pending':
      return 'bg-slate-500';
    case 'completed':
      return 'bg-emerald-500';
    case 'failed':
      return 'bg-red-500';
    case 'cancelled':
      return 'bg-amber-500';
    default:
      return 'bg-slate-500';
  }
}

function shortenLabel(summary: string): string {
  const compact = summary.replace(/\s+/g, ' ').trim();
  if (compact.length <= 16) {
    return compact;
  }
  return `${compact.slice(0, 15)}…`;
}

export function ChatTaskRail({ sessionId }: ChatTaskRailProps) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTasks = useCallback(async () => {
    if (!sessionId) {
      setTasks([]);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams({
        sessionId,
        limit: '8',
      });
      const response = await fetch(`/api/task-management/tasks?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load tasks');
      }

      const nextTasks = Array.isArray(data.tasks) ? data.tasks as TaskListItem[] : [];
      setTasks(nextTasks);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    if (!sessionId) {
      return undefined;
    }

    const refresh = () => {
      void loadTasks();
    };

    const interval = window.setInterval(refresh, 4000);
    window.addEventListener('focus', refresh);
    window.addEventListener('session-updated', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('session-updated', refresh);
    };
  }, [loadTasks, sessionId]);

  const orderedTasks = useMemo(() => {
    return [...tasks].sort((left, right) => {
      const priorityDiff = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  }, [tasks]);

  if (!sessionId || (!loading && orderedTasks.length === 0)) {
    return null;
  }

  const statusLabel = (status: TaskStatus) => t(`sidebar.taskStatus.${status}` as Parameters<typeof t>[0]);

  return (
    <aside className="hidden h-full w-[88px] shrink-0 border-l border-border/50 bg-background/70 px-2 py-3 lg:flex lg:flex-col lg:gap-2">
      <div className="px-1">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {t('sidebar.taskTags')}
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {orderedTasks.map((task) => {
          const href = `/workflow?sessionId=${encodeURIComponent(sessionId)}&taskId=${encodeURIComponent(task.id)}`;
          return (
            <Tooltip key={task.id}>
              <TooltipTrigger asChild>
                <Link
                  href={href}
                  className={cn(
                    'flex min-h-12 flex-col justify-center rounded-lg border px-2 py-2 text-left transition-colors hover:bg-accent/60',
                    getStatusClasses(task.status),
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', getStatusDotClasses(task.status))} />
                    <span className="truncate text-[10px] font-medium">
                      {statusLabel(task.status)}
                    </span>
                  </span>
                  <span className="mt-1 line-clamp-2 text-[10px] leading-4 text-current/90">
                    {shortenLabel(task.summary)}
                  </span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs">
                <p className="text-xs font-medium">{task.summary}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{statusLabel(task.status)}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <Link
        href={`/workflow?sessionId=${encodeURIComponent(sessionId)}`}
        className="px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {t('sidebar.taskTagsViewAll')}
      </Link>
    </aside>
  );
}
