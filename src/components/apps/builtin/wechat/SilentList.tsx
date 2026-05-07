'use client';

import * as React from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import type { OverviewRow } from '@/lib/wechat-assistant/overview-types';

const DAY = 24 * 60 * 60 * 1000;

/**
 * "久未联系" — sorts personal contacts by silence length descending and
 * renders each row as: name · 沉默天数 · 14d sparkline.
 *
 * Replaces the old GroupCalendarOverview heatmap, which compressed too many
 * dimensions into one 14-cell strip and didn't tell users *why* they should
 * care. This view answers a single question: 我有谁好久没联系了。
 */
export function SilentList({
  rows,
  nowMs,
  limit,
}: {
  rows: OverviewRow[];
  nowMs: number;
  limit?: number;
}): React.ReactElement {
  if (rows.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex min-h-32 items-center justify-center text-xs text-muted-foreground">
          没有数据
        </CardContent>
      </Card>
    );
  }
  // Newest contact has lowest silence — we want the most-silent on top.
  const sorted = [...rows]
    .sort((a, b) => a.lastTs - b.lastTs)
    .slice(0, limit ?? rows.length);
  const sparkMax = Math.max(
    1,
    ...rows.flatMap((r) => r.interactionDays.map((d) => d.count)),
  );
  return (
    <Card className="ring-1 ring-amber-500/15">
      <CardContent className="flex flex-col p-2">
        {sorted.map((row, idx) => (
          <Row key={row.id} row={row} nowMs={nowMs} sparkMax={sparkMax} first={idx === 0} />
        ))}
      </CardContent>
    </Card>
  );
}

function Row({
  row,
  nowMs,
  sparkMax,
  first,
}: {
  row: OverviewRow;
  nowMs: number;
  sparkMax: number;
  first: boolean;
}) {
  const silentDays = row.lastTs > 0 ? Math.floor((nowMs - row.lastTs) / DAY) : null;
  const tone = silenceTone(silentDays);
  const ordered = [...row.interactionDays].sort((a, b) => b.daysAgo - a.daysAgo);
  return (
    <div
      className={cn(
        'grid grid-cols-[1fr_auto_120px] items-center gap-3 px-2 py-2',
        !first && 'border-t',
      )}
    >
      <span className="min-w-0 truncate text-sm font-medium">{row.name}</span>
      <span
        className={cn(
          'shrink-0 text-[11px] tabular-nums',
          tone === 'rose' && 'text-rose-600',
          tone === 'amber' && 'text-amber-600',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {silentDays === null
          ? '—'
          : silentDays === 0
            ? '今天'
            : `${silentDays} 天前`}
      </span>
      <div className="flex items-end gap-0.5">
        {ordered.map((d) => (
          <div
            key={d.daysAgo}
            className={cn(
              'w-[6px] flex-none rounded-sm',
              d.count > 0 ? 'bg-foreground/70' : 'bg-foreground/8',
            )}
            style={{
              height: d.count > 0 ? `${Math.max(3, (d.count / sparkMax) * 18)}px` : '2px',
            }}
            title={`${d.daysAgo} 天前 · ${d.count} 条`}
          />
        ))}
      </div>
    </div>
  );
}

function silenceTone(days: number | null): 'muted' | 'amber' | 'rose' {
  if (days === null || days < 7) return 'muted';
  if (days < 14) return 'amber';
  return 'rose';
}
