'use client';

import * as React from 'react';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import type { OverviewRow } from '@/lib/wechat-assistant/overview-types';

export function InteractionRank({
  rows,
  onSelect,
  limit,
}: {
  rows: OverviewRow[];
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
  const sorted = [...rows]
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, limit ?? rows.length);
  const max = sorted[0]?.messageCount ?? 1;
  return (
    <Card className="ring-1 ring-sky-500/15">
      <CardContent className="flex flex-col gap-2 p-5">
        {sorted.map((p, idx) => {
          const pct = (p.messageCount / max) * 100;
          const Tag = onSelect ? 'button' : 'div';
          return (
            <Tag
              key={p.id}
              type={onSelect ? 'button' : undefined}
              onClick={onSelect ? () => onSelect(p.id) : undefined}
              className={cn(
                'group flex items-center gap-3 rounded-md py-1.5 text-left',
                onSelect && 'transition-colors hover:bg-muted/50',
              )}
            >
              <span className={cn('w-5 shrink-0 text-[11px] tabular-nums', rankNumberColor(idx))}>
                {String(idx + 1).padStart(2, '0')}
              </span>
              <span className="w-20 shrink-0 truncate text-sm font-medium">{p.name}</span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-sky-500/10">
                <div
                  className={cn('absolute inset-y-0 left-0 rounded-full', barColor(idx))}
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
              </div>
              <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {p.messageCount.toLocaleString('zh-CN')}
              </span>
            </Tag>
          );
        })}
      </CardContent>
    </Card>
  );
}

function barColor(idx: number): string {
  if (idx === 0) return 'bg-sky-600';
  if (idx === 1) return 'bg-sky-500';
  if (idx === 2) return 'bg-sky-500/75';
  return 'bg-sky-500/45';
}

function rankNumberColor(idx: number): string {
  if (idx === 0) return 'text-sky-700 dark:text-sky-300 font-semibold';
  if (idx === 1) return 'text-sky-600 dark:text-sky-400 font-medium';
  if (idx === 2) return 'text-sky-600/80 dark:text-sky-400/80';
  return 'text-muted-foreground';
}
