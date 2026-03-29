'use client';

import type { TeamBannerProjectionV1 } from '@/types';

interface TaskStatusBarProps {
  banner: TeamBannerProjectionV1 | null;
  onOpenActivity?: () => void;
}

const STATUS_ICONS: Record<string, string> = {
  running: '🔄',
  done: '✅',
  failed: '❌',
  pending: '⏳',
  ready: '🟡',
  blocked: '🚫',
  cancelled: '⊘',
};

export function TaskStatusBar({ banner, onOpenActivity }: TaskStatusBarProps) {
  if (!banner) return null;

  const icon = STATUS_ICONS[banner.runStatus] || STATUS_ICONS.pending;
  const pct = banner.totalStageCount > 0
    ? Math.round((banner.completedStageCount / banner.totalStageCount) * 100)
    : 0;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 border-t border-border/50 text-sm">
      <span className="text-xs">{icon}</span>
      <span className="truncate flex-1 text-muted-foreground">
        {banner.title}
        {banner.currentStageTitle && (
          <span className="ml-1.5 text-foreground/70">
            · {banner.currentStageTitle}
          </span>
        )}
      </span>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {banner.completedStageCount}/{banner.totalStageCount}
      </span>
      {banner.totalStageCount > 0 && (
        <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {onOpenActivity && (
        <button
          onClick={onOpenActivity}
          className="text-xs text-primary hover:underline whitespace-nowrap"
        >
          详情
        </button>
      )}
    </div>
  );
}
