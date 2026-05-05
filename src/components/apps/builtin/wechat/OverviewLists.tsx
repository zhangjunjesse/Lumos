'use client';

import * as React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { formatSeconds, type Analysis, type AnalysisHighlight } from './wechat-types';

export function HighlightList({ highlights }: { highlights: AnalysisHighlight[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between gap-2 space-y-0">
        <CardTitle className="text-base font-semibold tracking-tight">今日重点</CardTitle>
        <span className="text-xs text-muted-foreground tabular-nums">{highlights.length}</span>
      </CardHeader>
      <CardContent className="pt-0">
        {highlights.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">暂无</p>
        ) : (
          <ul className="flex flex-col">
            {highlights.map((item, index) => (
              <li
                key={`${item.title}-${index}`}
                className="flex gap-3 py-3 [&:not(:first-child)]:border-t"
              >
                <span className={cn('mt-2 size-1.5 shrink-0 rounded-full', toneDot(item.tone))} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="break-words text-sm font-medium leading-6">{item.title}</p>
                    <span className={cn('shrink-0 text-[10px] uppercase tracking-wider', toneTextColor(item.tone))}>
                      {toneLabel(item.tone)}
                    </span>
                  </div>
                  <p className="mt-0.5 break-words text-sm leading-6 text-muted-foreground">
                    {item.description}
                  </p>
                  {item.ts ? (
                    <p className="mt-1 text-[11px] tabular-nums text-muted-foreground/70">
                      {formatSeconds(item.ts)}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function TodoList({ todos }: { todos: Analysis['todos'] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between gap-2 space-y-0">
        <CardTitle className="text-base font-semibold tracking-tight">待办</CardTitle>
        <span className="text-xs text-muted-foreground tabular-nums">{todos.length}</span>
      </CardHeader>
      <CardContent className="pt-0">
        {todos.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">暂无</p>
        ) : (
          <ul className="flex flex-col">
            {todos.map((todo, index) => (
              <li
                key={`${todo.ts}-${index}`}
                className="flex gap-3 py-3 [&:not(:first-child)]:border-t"
              >
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground/30" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="break-words text-sm font-medium leading-6">{todo.text}</p>
                    <span
                      className={cn(
                        'shrink-0 text-[10px] uppercase tracking-wider',
                        todo.confidence === 'high' ? 'text-foreground' : 'text-muted-foreground/70',
                      )}
                    >
                      {todo.confidence === 'high' ? '高置信' : '待确认'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground/70">
                    {todo.display} · {formatSeconds(todo.ts)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function ActiveConversations({ items }: { items: Analysis['topConversations'] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between gap-2 space-y-0">
        <CardTitle className="text-base font-semibold tracking-tight">活跃会话</CardTitle>
        <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
      </CardHeader>
      <CardContent className="pt-0">
        {items.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">暂无</p>
        ) : (
          <div className="flex flex-col">
            {items.map((item) => (
              <div
                key={item.wxid}
                className="flex items-center gap-3 py-3 [&:not(:first-child)]:border-t"
              >
                <Avatar text={item.display} isGroup={item.isGroup} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.display}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {item.isGroup ? '群聊' : '联系人'} · {formatSeconds(item.lastAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-base font-semibold tabular-nums">{item.count}</p>
                  {item.unread > 0 ? (
                    <p className="text-[11px] tabular-nums text-amber-600">
                      {item.unread} 未读
                    </p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Avatar({ text, isGroup }: { text: string; isGroup: boolean }) {
  const ch = [...text.trim()][0] ?? '?';
  return (
    <div
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-medium ring-1 ring-border',
        isGroup ? 'bg-muted text-muted-foreground' : 'bg-background text-foreground',
      )}
    >
      {ch}
    </div>
  );
}

export function KeywordCloud({ trends }: { trends: Analysis['keywordTrends'] }) {
  const max = Math.max(1, ...trends.map((t) => t.count));
  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between gap-2 space-y-0">
        <CardTitle className="text-base font-semibold tracking-tight">关键词</CardTitle>
        <span className="text-xs text-muted-foreground tabular-nums">{trends.length}</span>
      </CardHeader>
      <CardContent className="pt-0">
        {trends.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">暂无</p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            {trends.map((item) => {
              const ratio = item.count / max;
              return (
                <span
                  key={item.keyword}
                  className={cn(
                    'inline-flex items-baseline gap-1 tabular-nums',
                    ratio > 0.75 && 'text-2xl font-semibold tracking-tight text-foreground',
                    ratio > 0.5 && ratio <= 0.75 && 'text-xl text-foreground',
                    ratio > 0.25 && ratio <= 0.5 && 'text-base text-muted-foreground',
                    ratio <= 0.25 && 'text-sm text-muted-foreground/70',
                  )}
                >
                  {item.keyword}
                  <span className="text-[10px] text-muted-foreground/60">{item.count}</span>
                </span>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function toneDot(tone: AnalysisHighlight['tone']): string {
  if (tone === 'danger') return 'bg-rose-500';
  if (tone === 'warning') return 'bg-amber-500';
  if (tone === 'success') return 'bg-emerald-500';
  return 'bg-sky-500';
}

function toneTextColor(tone: AnalysisHighlight['tone']): string {
  if (tone === 'danger') return 'text-rose-600';
  if (tone === 'warning') return 'text-amber-600';
  if (tone === 'success') return 'text-emerald-600';
  return 'text-sky-600';
}

function toneLabel(tone: AnalysisHighlight['tone']): string {
  if (tone === 'danger') return '紧急';
  if (tone === 'warning') return '重要';
  if (tone === 'success') return '正常';
  return '关注';
}
