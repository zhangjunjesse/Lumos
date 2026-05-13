'use client';

import * as React from 'react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Empty-state panel shown when the videos list is empty. Two modes:
 *
 *   1. activeCount > 0 → "you filtered everything out" → offer reset.
 *   2. activeCount === 0 → "library is empty" → first-run / onboarding hint.
 *
 * Extracted from LibraryTab in round 9.
 */
export function LibraryEmptyState({
  activeFilterCount,
  onClearAll,
}: {
  activeFilterCount: number;
  onClearAll: () => void;
}): React.ReactElement {
  if (activeFilterCount > 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
        <p className="text-sm font-medium">没有匹配当前筛选的视频</p>
        <p className="max-w-md text-xs text-muted-foreground">
          你叠了 {activeFilterCount} 个筛选条件。逐个清除每个 chip，或一键重置。
        </p>
        <Button size="sm" variant="outline" onClick={onClearAll}>
          <X className="size-3.5" />
          重置全部 ({activeFilterCount})
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-6 py-16 text-center">
      <p className="text-sm font-medium">资料库还是空的</p>
      <p className="max-w-md text-xs text-muted-foreground">
        新增博主或关键词订阅后，点「立即采集」会把视频抓进来。
      </p>
    </div>
  );
}
