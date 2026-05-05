'use client';

import * as React from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import type {
  GroupRoleEntry,
  PortraitGroups,
  PortraitHighlight,
  PortraitStyle,
} from './portrait-types';

const ROLE_ACCENT: Record<GroupRoleEntry['role'], string> = {
  '潜水党': 'bg-foreground/10 text-muted-foreground',
  '气氛组': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  '话题灵魂': 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  '广播站': 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
};

const ROLE_BAR: Record<GroupRoleEntry['role'], string> = {
  '潜水党': 'bg-foreground/30',
  '气氛组': 'bg-emerald-500',
  '话题灵魂': 'bg-amber-500',
  '广播站': 'bg-violet-500',
};

export function PortraitStyleCard({ data }: { data: PortraitStyle }): React.ReactElement {
  const wordMax = Math.max(1, ...data.wordTop.map((w) => w.count));
  const topEmoji = data.emojiTop[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-baseline gap-2 text-base font-semibold tracking-tight">
          风格
          <span className="text-xs font-normal text-muted-foreground">· {data.label}</span>
        </CardTitle>
        <CardDescription className="break-words">{data.summary}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6 pt-2">
        <div className="grid grid-cols-4 gap-px overflow-hidden rounded-lg bg-border">
          <StyleStat label="消息" value={String(data.yourMessageCount)} />
          <StyleStat label="均字" value={String(data.avgLength)} />
          <StyleStat label="问句" value={`${Math.round(data.questionRate * 100)}%`} />
          <StyleStat label="感叹" value={`${Math.round(data.exclaimRate * 100)}%`} />
        </div>
        {topEmoji ? (
          <div className="flex items-end justify-between gap-4 border-y py-4">
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground">最爱表情</p>
              <p className="mt-1 text-5xl leading-none">{topEmoji.emoji}</p>
            </div>
            <div className="flex flex-wrap items-end gap-3 text-sm">
              {data.emojiTop.slice(1, 6).map((item) => (
                <span key={item.emoji} className="inline-flex items-baseline gap-1">
                  <span className="text-2xl leading-none">{item.emoji}</span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {item.count}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        <div>
          <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">高频词</p>
          {data.wordTop.length === 0 ? (
            <p className="text-xs text-muted-foreground">—</p>
          ) : (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
              {data.wordTop.map((item) => {
                const ratio = item.count / wordMax;
                return (
                  <span
                    key={item.word}
                    className={cn(
                      'inline-flex items-baseline gap-1 tabular-nums tracking-tight',
                      ratio > 0.75 && 'text-xl font-semibold text-foreground',
                      ratio > 0.5 && ratio <= 0.75 && 'text-base text-foreground',
                      ratio > 0.25 && ratio <= 0.5 && 'text-sm text-muted-foreground',
                      ratio <= 0.25 && 'text-xs text-muted-foreground/70',
                    )}
                  >
                    {item.word}
                    <span className="text-[10px] text-muted-foreground/60">{item.count}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StyleStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-3 py-3 text-center">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

export function PortraitGroupsCard({ data }: { data: PortraitGroups }): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold tracking-tight">群聊</CardTitle>
        <CardDescription className="break-words">{data.summary}</CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        {data.topGroups.length === 0 ? (
          <p className="text-xs text-muted-foreground">—</p>
        ) : (
          <div className="flex flex-col">
            {data.topGroups.map((group) => (
              <div key={group.wxid} className="flex flex-col gap-2 py-3 [&:not(:first-child)]:border-t">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-medium">{group.display}</p>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                      ROLE_ACCENT[group.role],
                    )}
                  >
                    {group.role}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full', ROLE_BAR[group.role])}
                      style={{ width: `${Math.min(100, Math.max(0, group.participation * 100))}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {group.yourCount}/{group.count} · {Math.round(group.participation * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function PortraitHighlightsCard({ items }: { items: PortraitHighlight[] }): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold tracking-tight">高光</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="grid gap-px overflow-hidden rounded-lg bg-border md:grid-cols-2 xl:grid-cols-3">
          {items.map((item, idx) => (
            <div key={item.label} className="flex flex-col gap-2 bg-card p-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  {item.label}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground/60">
                  #{idx + 1}
                </span>
              </div>
              <p className="break-words text-sm leading-6">{item.detail}</p>
              {item.meta ? (
                <p className="mt-auto text-[11px] tabular-nums text-muted-foreground">{item.meta}</p>
              ) : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
