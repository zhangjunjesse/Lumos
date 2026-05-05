'use client';

import * as React from 'react';
import { CheckCircle2, CircleDot, FileEdit, Hourglass, PauseCircle } from 'lucide-react';

import type { BuilderStoryStatus } from '@/lib/app/builder/session';
import { APP_BUILDER_STORY_STATUS_LABELS } from '@/lib/app/builder/sop';
import { cn } from '@/lib/utils';

export interface StatusMeta {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  pill: string;
  solid: string;
  accent: string;
  divider: string;
  dot: string;
  text: string;
}

const PRIMARY = {
  pill: 'bg-primary/10 text-primary',
  solid: 'bg-primary/15 text-primary ring-1 ring-primary/20',
  accent: 'bg-primary/70',
  divider: 'bg-gradient-to-r from-primary/50 via-primary/20 to-transparent',
  dot: 'bg-primary',
  text: 'text-primary',
} as const;

const EMERALD = {
  pill: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  solid: 'bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/20 dark:text-emerald-300',
  accent: 'bg-emerald-500/70',
  divider: 'bg-gradient-to-r from-emerald-400/60 via-emerald-400/30 to-transparent',
  dot: 'bg-emerald-500',
  text: 'text-emerald-700 dark:text-emerald-400',
} as const;

export const STATUS_META: Record<BuilderStoryStatus, StatusMeta> = {
  draft: {
    label: APP_BUILDER_STORY_STATUS_LABELS.draft,
    icon: FileEdit,
    pill: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
    solid: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    accent: 'bg-slate-400/60',
    divider: 'bg-gradient-to-r from-slate-300/60 via-slate-300/30 to-transparent',
    dot: 'bg-slate-400',
    text: 'text-slate-600 dark:text-slate-400',
  },
  pending_confirmation: {
    label: APP_BUILDER_STORY_STATUS_LABELS.pending_confirmation,
    icon: Hourglass,
    pill: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    solid: 'bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-300',
    accent: 'bg-amber-500/70',
    divider: 'bg-gradient-to-r from-amber-400/60 via-amber-400/30 to-transparent',
    dot: 'bg-amber-500',
    text: 'text-amber-700 dark:text-amber-400',
  },
  confirmed: { label: APP_BUILDER_STORY_STATUS_LABELS.confirmed, icon: CheckCircle2, ...PRIMARY },
  in_progress: { label: APP_BUILDER_STORY_STATUS_LABELS.in_progress, icon: CircleDot, ...PRIMARY },
  implemented: { label: APP_BUILDER_STORY_STATUS_LABELS.implemented, icon: CheckCircle2, ...EMERALD },
  accepted: { label: APP_BUILDER_STORY_STATUS_LABELS.accepted, icon: CheckCircle2, ...EMERALD },
  deferred: {
    label: APP_BUILDER_STORY_STATUS_LABELS.deferred,
    icon: PauseCircle,
    pill: 'bg-muted text-muted-foreground',
    solid: 'bg-muted text-muted-foreground ring-1 ring-border',
    accent: 'bg-muted-foreground/40',
    divider: 'bg-gradient-to-r from-border via-border/50 to-transparent',
    dot: 'bg-muted-foreground/60',
    text: 'text-muted-foreground',
  },
};

export function isConfirmedStatus(status: BuilderStoryStatus): boolean {
  return status === 'confirmed'
    || status === 'in_progress'
    || status === 'implemented'
    || status === 'accepted';
}

export function StoryStatusBadge({
  status,
  variant = 'subtle',
}: {
  status: BuilderStoryStatus;
  variant?: 'subtle' | 'solid';
}): React.ReactElement {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium',
        variant === 'solid' ? meta.solid : meta.pill,
      )}
    >
      <Icon className="size-3" />
      {meta.label}
    </span>
  );
}

export function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(ms).toLocaleDateString();
}
