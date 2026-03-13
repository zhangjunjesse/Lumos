'use client';

import { AlertTriangle, Bot, CheckCircle2, X } from 'lucide-react';
import type { BrowserAiActivity } from '@/types/browser';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/hooks/useTranslation';

export type AIActivity = BrowserAiActivity;

export interface AIActivityBannerProps {
  activity: BrowserAiActivity | null;
  onDismiss?: () => void;
}

function getTone(status: BrowserAiActivity['status']) {
  switch (status) {
    case 'success':
      return {
        container: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
        icon: CheckCircle2,
      };
    case 'error':
      return {
        container: 'border-rose-400/40 bg-rose-500/10 text-rose-900 dark:text-rose-100',
        icon: AlertTriangle,
      };
    default:
      return {
        container: 'border-sky-400/40 bg-sky-500/10 text-sky-900 dark:text-sky-100',
        icon: Bot,
      };
  }
}

export function AIActivityBanner({ activity, onDismiss }: AIActivityBannerProps) {
  const { t } = useTranslation();

  if (!activity) {
    return null;
  }

  const tone = getTone(activity.status);
  const StatusIcon = tone.icon;

  return (
    <div
      className={cn(
        'flex items-start gap-3 border-b px-4 py-3 backdrop-blur-sm',
        tone.container,
      )}
    >
      <div className="mt-0.5 rounded-full bg-background/60 p-2">
        <StatusIcon className={cn('size-4', activity.status === 'running' && 'animate-pulse')} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{activity.action}</div>
        {activity.details && (
          <div className="mt-0.5 text-sm opacity-80">{activity.details}</div>
        )}
      </div>

      {onDismiss && activity.status !== 'running' && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="rounded-full"
          onClick={onDismiss}
          title={t('browser.dismiss')}
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
}
