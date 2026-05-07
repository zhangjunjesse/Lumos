'use client';

import * as React from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import type { OverviewRow } from '@/lib/wechat-assistant/overview-types';

const DAY = 24 * 60 * 60 * 1000;

export function GroupCalendarOverview({
  rows,
  nowMs,
  onSelect,
  limit,
}: {
  rows: OverviewRow[];
  /** Reference time for "X days silent" labels — passed in for purity. */
  nowMs: number;
  onSelect?: (id: string) => void;
  limit?: number;
}): React.ReactElement {
  if (rows.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex min-h-32 items-center justify-center text-xs text-muted-foreground">
          这一组没有人
        </CardContent>
      </Card>
    );
  }
  // 按沉默优先排序（很久没说话的浮上来）
  const sorted = [...rows]
    .sort((a, b) => a.lastTs - b.lastTs)
    .slice(0, limit ?? rows.length);
  const max = Math.max(
    1,
    ...rows.flatMap((r) => r.interactionDays.map((d) => d.count)),
  );
  return (
    <Card className="ring-1 ring-emerald-500/15">
      <CardContent className="flex flex-col p-3">
        {sorted.map((row, idx) => (
          <PersonRow
            key={row.id}
            row={row}
            nowMs={nowMs}
            max={max}
            first={idx === 0}
            onSelect={onSelect ? () => onSelect(row.id) : undefined}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function PersonRow({
  row,
  nowMs,
  max,
  first,
  onSelect,
}: {
  row: OverviewRow;
  nowMs: number;
  max: number;
  first: boolean;
  onSelect?: () => void;
}) {
  const ordered = [...row.interactionDays].sort((a, b) => b.daysAgo - a.daysAgo);
  const lastDays = row.lastTs > 0 ? Math.round((nowMs - row.lastTs) / DAY) : null;
  const silentBadge = lastDays !== null ? silentLabel(lastDays) : null;
  const Tag = onSelect ? 'button' : 'div';
  return (
    <Tag
      type={onSelect ? 'button' : undefined}
      onClick={onSelect}
      className={cn(
        'group flex items-center gap-3 px-2 py-2 text-left',
        onSelect && 'transition-colors hover:bg-muted/50',
        !first && 'border-t',
      )}
    >
      <span className="w-20 shrink-0 truncate text-sm font-medium">{row.name}</span>
      <div className="flex flex-1 items-center gap-0.5">
        {ordered.map((d) => (
          <div
            key={d.daysAgo}
            className={cn('h-3 flex-1 rounded-sm', intensityClass(d.count / max))}
            title={`${d.daysAgo} 天前 · ${d.count} 条`}
          />
        ))}
      </div>
      {silentBadge ? (
        <span className={cn('w-16 shrink-0 text-right text-[11px]', silentBadge.tone)}>
          {silentBadge.text}
        </span>
      ) : (
        <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground">
          活跃
        </span>
      )}
    </Tag>
  );
}

function intensityClass(ratio: number): string {
  if (ratio === 0) return 'bg-emerald-500/8';
  if (ratio < 0.25) return 'bg-emerald-500/25';
  if (ratio < 0.5) return 'bg-emerald-500/50';
  if (ratio < 0.75) return 'bg-emerald-500/75';
  return 'bg-emerald-600';
}

function silentLabel(lastDays: number): { text: string; tone: string } | null {
  if (lastDays >= 14) return { text: `${lastDays} 天 ⓘ`, tone: 'text-rose-600' };
  if (lastDays >= 7) return { text: `${lastDays} 天`, tone: 'text-amber-600' };
  return null;
}
