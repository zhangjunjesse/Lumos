'use client';

import * as React from 'react';
import { Sparkles, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import {
  fallbackData,
  type CustomReport,
  type CustomReportTemplate,
} from './custom-reports';
import type { OverviewData } from '@/lib/wechat-assistant/overview-types';

const ACCENT: Record<CustomReportTemplate, { ring: string; tag: string; dot: string }> = {
  emoji: {
    ring: 'ring-amber-500/30',
    tag: 'text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  night_chat: {
    ring: 'ring-violet-500/30',
    tag: 'text-violet-700 dark:text-violet-400',
    dot: 'bg-violet-500',
  },
  commitment: {
    ring: 'ring-emerald-500/30',
    tag: 'text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  mention_week: {
    ring: 'ring-sky-500/30',
    tag: 'text-sky-700 dark:text-sky-400',
    dot: 'bg-sky-500',
  },
  fallback: {
    ring: 'ring-border',
    tag: 'text-muted-foreground',
    dot: 'bg-muted-foreground',
  },
};

export function CustomReportCard({
  report,
  data,
  onRemove,
}: {
  report: CustomReport;
  data: OverviewData;
  onRemove: (id: string) => void;
}): React.ReactElement {
  const accent = ACCENT[report.template];
  return (
    <Card className={cn('ring-1', accent.ring)}>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className={cn('flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em]', accent.tag)}>
              <Sparkles className="size-3" />
              自定义统计
            </div>
            <p className="mt-1 text-base font-semibold tracking-tight">{report.title}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">来自你说：「{report.prompt}」</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="-mr-2 text-muted-foreground hover:text-rose-600"
            onClick={() => onRemove(report.id)}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
        <ReportBody report={report} data={data} />
      </CardContent>
    </Card>
  );
}

function ReportBody({ report, data }: { report: CustomReport; data: OverviewData }) {
  switch (report.template) {
    case 'emoji':
      return <EmojiBody data={data} />;
    case 'night_chat':
      return <NightChatBody data={data} />;
    case 'commitment':
      return <CommitmentBody data={data} />;
    case 'mention_week':
      return <MentionWeekBody data={data} />;
    case 'fallback':
      return <FallbackBody data={data} />;
  }
}

function EmptyReport({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function EmojiBody({ data }: { data: OverviewData }) {
  const rows = data.reportInsights.emoji;
  if (rows.length === 0) {
    return <EmptyReport>当前分析窗口内没有识别到常用表情。</EmptyReport>;
  }
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-3">
      {rows.map((row) => (
        <span key={row.emoji} className="inline-flex flex-col items-center">
          <span className={fontFor(row.count / max)}>{row.emoji}</span>
          <span className="text-[10px] tabular-nums text-amber-600 dark:text-amber-400">
            {row.count}
          </span>
        </span>
      ))}
    </div>
  );
}

function fontFor(ratio: number): string {
  if (ratio > 0.75) return 'text-4xl';
  if (ratio > 0.5) return 'text-3xl';
  if (ratio > 0.25) return 'text-2xl';
  return 'text-xl';
}

function NightChatBody({ data }: { data: OverviewData }) {
  const report = data.reportInsights.lateChat;
  if (report.totalLateMessages === 0) {
    return <EmptyReport>当前分析窗口内没有 22:00 到 02:00 的聊天记录。</EmptyReport>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm leading-6">
        过去 {data.windowDays} 天，你在 22:00-02:00 之间收发了{' '}
        <span className="font-semibold tabular-nums text-violet-700 dark:text-violet-400">
          {report.totalLateMessages.toLocaleString('zh-CN')}
        </span>{' '}
        条消息（总量的{' '}
        <span className="font-semibold tabular-nums text-violet-700 dark:text-violet-400">
          {Math.round(report.share * 100)}%
        </span>
        ）。
      </p>
      <ul className="flex flex-col">
        {report.rows.map((row, i) => (
          <li
            key={row.id}
            className={cn('flex items-center gap-3 py-2 text-sm', i > 0 && 'border-t')}
          >
            <span
              className={cn(
                'inline-block size-1.5 shrink-0 rounded-full',
                i === 0 ? 'bg-violet-600' : i === 1 ? 'bg-violet-500' : 'bg-violet-500/50',
              )}
            />
            <span className="flex-1">{row.name}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {row.messages} 条 · {Math.round(row.share * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CommitmentBody({ data }: { data: OverviewData }) {
  const rows = data.reportInsights.commitments;
  if (rows.length === 0) {
    return <EmptyReport>当前分析窗口内没有识别到明显的疑似承诺消息。</EmptyReport>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border">
        <Stat label="疑似承诺" value={rows.length} />
        <Stat label="需要确认" value={rows.length} accent="emerald" />
      </div>
      <ul className="flex flex-col">
        {rows.map((row, i) => (
          <li
            key={row.id}
            className={cn('flex items-baseline justify-between gap-2 py-2 text-sm', i > 0 && 'border-t')}
          >
            <span className="min-w-0 truncate">
              <span className="text-muted-foreground">→ {row.who}</span>
              <span className="ml-2">{row.text}</span>
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {formatShortDate(row.promisedAt)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: number;
  suffix?: string;
  accent?: 'emerald' | 'rose';
}) {
  return (
    <div className="bg-card px-3 py-3 text-center">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums tracking-tight',
          accent === 'emerald' && 'text-emerald-700 dark:text-emerald-400',
          accent === 'rose' && value > 0 && 'text-rose-600',
        )}
      >
        {value}
        {suffix ? <span className="ml-0.5 text-xs font-normal text-muted-foreground">{suffix}</span> : null}
      </p>
    </div>
  );
}

function MentionWeekBody({ data }: { data: OverviewData }) {
  const rows = data.reportInsights.mentionWeek;
  if (rows.length === 0) {
    return <EmptyReport>最近 7 天没有足够的对话统计。</EmptyReport>;
  }
  const max = Math.max(...rows.map((r) => r.mentions));
  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, idx) => {
        const pct = (row.mentions / max) * 100;
        return (
          <div key={row.id} className="flex items-center gap-3 py-1 text-sm">
            <span className="w-32 shrink-0 truncate font-medium">{row.name}</span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-sky-500/10">
              <div
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full',
                  idx === 0 ? 'bg-sky-600' : idx === 1 ? 'bg-sky-500' : 'bg-sky-500/65',
                )}
                style={{ width: `${Math.max(2, pct)}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              {row.mentions}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function FallbackBody({ data }: { data: OverviewData }) {
  const items = fallbackData(data.rows);
  if (items.length === 0) {
    return <EmptyReport>当前分析窗口内暂无可生成报表的数据。</EmptyReport>;
  }
  const max = Math.max(...items.map((r) => r.messages), 1);
  return (
    <div className="flex flex-col gap-2">
      {items.map((row) => (
        <div key={row.name} className="flex items-center gap-3 py-1 text-sm">
          <span className="w-24 shrink-0 truncate font-medium">{row.name}</span>
          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-foreground/60"
              style={{ width: `${Math.max(2, (row.messages / max) * 100)}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {row.messages}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatShortDate(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}
