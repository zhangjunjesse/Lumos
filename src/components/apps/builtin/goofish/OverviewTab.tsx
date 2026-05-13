'use client';

import * as React from 'react';
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  FileText,
  Inbox,
  Loader2,
  RefreshCw,
  Sparkles,
  Timer,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { GoofishKpi, GoofishNotification } from './use-goofish-overview';

interface OverviewTabProps {
  kpi: GoofishKpi | null;
  recentNotifications: GoofishNotification[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  ready: boolean;
  draftsByDay: Array<{ dateLabel: string; count: number }>;
  onRefresh: () => void;
}

export function OverviewTab({
  kpi,
  recentNotifications,
  loading,
  refreshing,
  error,
  ready,
  draftsByDay,
  onRefresh,
}: OverviewTabProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-10">
      <Toolbar refreshing={refreshing} onRefresh={onRefresh} />
      <Body
        kpi={kpi}
        recentNotifications={recentNotifications}
        loading={loading}
        refreshing={refreshing}
        error={error}
        ready={ready}
        draftsByDay={draftsByDay}
      />
    </div>
  );
}

function Body({
  kpi,
  recentNotifications,
  loading,
  refreshing,
  error,
  ready,
  draftsByDay,
}: Omit<OverviewTabProps, 'onRefresh'>): React.ReactElement {
  if ((loading || refreshing) && !kpi) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">加载中…</p>
      </div>
    );
  }
  if (!kpi) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-center">
        <AlertCircle className="size-5 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          {ready ? '暂无可分析的数据。' : '请先完成账号授权。'}
        </p>
        {error ? <p className="text-[11px] text-muted-foreground">{error}</p> : null}
      </div>
    );
  }

  return (
    <>
      <KpiGrid kpi={kpi} />
      <DailyDraftsBlock series={draftsByDay} />
      <RecentNotificationBlock items={recentNotifications} />
    </>
  );
}

function Toolbar({
  refreshing,
  onRefresh,
}: {
  refreshing: boolean;
  onRefresh: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4 text-xs">
      <p className="text-muted-foreground">
        实时统计 · 数据来自闲鱼会话同步与本地草稿/规则记录
      </p>
      <Button onClick={onRefresh} disabled={refreshing} size="sm" variant="outline">
        {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        {refreshing ? '刷新中' : '刷新'}
      </Button>
    </div>
  );
}

function KpiGrid({ kpi }: { kpi: GoofishKpi }): React.ReactElement {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-border ring-1 ring-border md:grid-cols-5">
      <KpiCell
        icon={<Inbox className="size-3.5 text-muted-foreground" />}
        label="未读买家"
        value={kpi.unreadInboxCount}
      />
      <KpiCell
        icon={<Timer className="size-3.5 text-muted-foreground" />}
        label="待回复堆积"
        value={kpi.pendingReplyCount}
        accent={kpi.pendingReplyCount > 0 ? 'amber' : undefined}
      />
      <KpiCell
        icon={<FileText className="size-3.5 text-muted-foreground" />}
        label="今日草稿"
        value={kpi.draftsTodayCount}
      />
      <KpiCell
        icon={<Sparkles className="size-3.5 text-muted-foreground" />}
        label="白名单命中"
        value={kpi.whitelistMatchCount}
      />
      <KpiCell
        icon={<BellRing className="size-3.5 text-muted-foreground" />}
        label="24h 提醒"
        value={kpi.recentReminderCount}
        accent={kpi.recentReminderCount > 0 ? 'amber' : undefined}
      />
    </div>
  );
}

function KpiCell({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: 'amber';
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2 bg-card px-6 py-5 transition-colors hover:bg-card/60">
      <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {label}
      </p>
      <p
        className={cn(
          'text-[32px] font-semibold tabular-nums leading-none tracking-tight',
          accent === 'amber' && 'text-amber-600',
        )}
      >
        {value.toLocaleString('zh-CN')}
      </p>
    </div>
  );
}

function DailyDraftsBlock({
  series,
}: {
  series: Array<{ dateLabel: string; count: number }>;
}): React.ReactElement {
  const max = series.reduce((m, item) => Math.max(m, item.count), 0);
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">最近 7 天草稿生成</h3>
        <p className="text-[11px] text-muted-foreground">每日新增草稿数量</p>
      </header>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl bg-border ring-1 ring-border">
        {series.map((item) => (
          <DailyBar key={item.dateLabel} {...item} max={max} />
        ))}
      </div>
    </section>
  );
}

function DailyBar({
  dateLabel,
  count,
  max,
}: {
  dateLabel: string;
  count: number;
  max: number;
}): React.ReactElement {
  const ratio = max > 0 ? Math.max(0.06, count / max) : 0;
  return (
    <div className="flex flex-col items-center gap-2 bg-card px-2 py-4">
      <div className="flex h-16 w-full items-end justify-center">
        <div
          className={cn(
            'w-3 rounded-t bg-foreground/15 transition-colors',
            count > 0 && 'bg-amber-500/70',
          )}
          style={{ height: count === 0 ? '4px' : `${ratio * 100}%` }}
        />
      </div>
      <p className="text-[11px] tabular-nums text-foreground">{count}</p>
      <p className="text-[10px] text-muted-foreground">{dateLabel}</p>
    </div>
  );
}

function RecentNotificationBlock({
  items,
}: {
  items: GoofishNotification[];
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">最近 5 条提醒</h3>
        <p className="text-[11px] text-muted-foreground">来自 app_notifications</p>
      </header>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-8 text-center">
          <CheckCircle2 className="size-4 text-emerald-500" />
          <p className="text-xs text-muted-foreground">暂无提醒，所有买家消息都已被你的规则覆盖。</p>
        </div>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {items.map((item) => (
            <NotificationRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  );
}

function NotificationRow({ item }: { item: GoofishNotification }): React.ReactElement {
  const text = item.text || item.message || '提醒';
  const title = item.title || '提醒';
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <BellRing className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 break-words text-[12px] text-muted-foreground">{text}</p>
      </div>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        <RelativeTime ts={item.createdAt} />
      </span>
    </li>
  );
}

function RelativeTime({ ts }: { ts: number }): React.ReactElement {
  const [label, setLabel] = React.useState(() => formatRelative(ts, Date.now()));
  React.useEffect(() => {
    const tick = () => setLabel(formatRelative(ts, Date.now()));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [ts]);
  return <span className="tabular-nums">{label}</span>;
}

function formatRelative(ts: number, now: number): string {
  const diff = now - ts;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return '刚刚';
  if (diff < hr) return `${Math.round(diff / min)} 分钟前`;
  if (diff < day) return `${Math.round(diff / hr)} 小时前`;
  const d = new Date(ts);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
