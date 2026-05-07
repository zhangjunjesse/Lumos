'use client';

import * as React from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import type { PersonInteractionDay } from './relations-types';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export function CalendarHeatmap({
  days,
  lastInteractionTs,
}: {
  days: PersonInteractionDay[];
  lastInteractionTs: number;
}): React.ReactElement {
  const max = Math.max(1, ...days.map((d) => d.count));
  const today = new Date();
  // ordered: oldest -> newest (for left-to-right reading)
  const ordered = [...days].sort((a, b) => b.daysAgo - a.daysAgo);
  const lastDays = Math.round((today.getTime() - lastInteractionTs) / (24 * 60 * 60 * 1000));
  const silent = lastDays >= 7;
  return (
    <Card className="ring-1 ring-emerald-500/15">
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-end gap-1">
          {ordered.map((d) => {
            const date = new Date(today.getTime() - d.daysAgo * 24 * 60 * 60 * 1000);
            const intensity = d.count / max;
            return (
              <div
                key={d.daysAgo}
                className="flex flex-col items-center gap-1"
                title={`${date.getMonth() + 1}-${date.getDate()} (${WEEKDAYS[date.getDay()]}) · ${d.count} 条`}
              >
                <div
                  className={cn('size-5 rounded-sm', intensityClass(intensity))}
                />
                {d.daysAgo % 3 === 0 ? (
                  <span className="text-[9px] tabular-nums text-muted-foreground/60">
                    {date.getDate()}
                  </span>
                ) : (
                  <span className="text-[9px] opacity-0">.</span>
                )}
              </div>
            );
          })}
        </div>
        <p className={cn(
          'text-[11px]',
          silent ? 'text-amber-600' : 'text-muted-foreground',
        )}>
          {silent
            ? `已 ${lastDays} 天没说话`
            : `最近 14 天 ${days.reduce((s, d) => s + d.count, 0)} 条互动`}
        </p>
      </CardContent>
    </Card>
  );
}

function intensityClass(ratio: number): string {
  if (ratio === 0) return 'bg-emerald-500/8';
  if (ratio < 0.25) return 'bg-emerald-500/25';
  if (ratio < 0.5) return 'bg-emerald-500/50';
  if (ratio < 0.75) return 'bg-emerald-500/75';
  return 'bg-emerald-600';
}
