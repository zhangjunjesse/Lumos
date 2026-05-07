'use client';

import * as React from 'react';
import { AlertCircle, Loader2, Plus, RefreshCw, Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { AddReportDialog } from './AddReportDialog';
import { CustomReportCard } from './CustomReportCard';
import { InteractionRank } from './InteractionRank';
import { MessageSearchPanel, type MessageSearchRequest } from './MessageSearchPanel';
import { PanelBlock } from './PanelBlock';
import { SilentList } from './SilentList';
import { TopicPanel } from './TopicPanel';
import {
  defaultTitle,
  routeReportTemplate,
  type CustomReport,
} from './custom-reports';
import type {
  OverviewData,
  OverviewReason,
} from '@/lib/wechat-assistant/overview-types';
import type { TopicProgress, TopicSummaryView } from './use-wechat-topics';

export interface TopicPanelProps {
  showTopics: boolean;
  hasProvider: boolean;
  dateFrom: string;
  dateTo: string;
  whitelistPersonalCount: number;
  whitelistGroupsCount: number;
  personalSummary: TopicSummaryView | null;
  groupSummary: TopicSummaryView | null;
  personalProgress: TopicProgress | null;
  groupProgress: TopicProgress | null;
  onRunPersonal: () => void;
  onRunGroup: () => void;
  onDateRangeChange: (range: { from: string; to: string }) => void;
  onConfigureTopics: () => void;
}

export function OverviewTab({
  data,
  loading,
  ready,
  reason,
  error,
  analyzing,
  customReports,
  showInteractionRank,
  showHeatmap,
  windowDays,
  onAnalyze,
  onAddReport,
  onRemoveReport,
  searchRequest,
  topics,
}: {
  data: OverviewData | null;
  loading: boolean;
  ready: boolean;
  reason: OverviewReason | null;
  error: string | null;
  analyzing: boolean;
  customReports: CustomReport[];
  showInteractionRank: boolean;
  showHeatmap: boolean;
  windowDays: number;
  onAnalyze: () => void;
  onAddReport: (report: CustomReport) => void;
  onRemoveReport: (id: string) => void;
  searchRequest?: MessageSearchRequest | null;
  topics: TopicPanelProps;
}): React.ReactElement {
  const [addOpen, setAddOpen] = React.useState(false);

  const handleAddPrompt = (prompt: string) => {
    const template = routeReportTemplate(prompt);
    onAddReport({
      id: `r-${Date.now()}`,
      template,
      title: defaultTitle(template),
      prompt,
      createdAt: Date.now(),
    });
  };

  return (
    <div className="flex flex-col gap-10">
      <Toolbar
        windowDays={windowDays}
        lastAnalyzedAt={data?.generatedAt ?? null}
        analyzing={analyzing}
        onAnalyze={onAnalyze}
      />

      <Body
        data={data}
        loading={loading}
        ready={ready}
        reason={reason}
        error={error}
        analyzing={analyzing}
        showInteractionRank={showInteractionRank}
        showHeatmap={showHeatmap}
        topics={topics}
        customReports={customReports}
        onRemoveReport={onRemoveReport}
        onOpenAddReport={() => setAddOpen(true)}
        searchRequest={searchRequest}
      />

      <AddReportDialog open={addOpen} onOpenChange={setAddOpen} onSubmit={handleAddPrompt} />
    </div>
  );
}

function Body({
  data,
  loading,
  ready,
  reason,
  error,
  analyzing,
  showInteractionRank,
  showHeatmap,
  topics,
  customReports,
  onRemoveReport,
  onOpenAddReport,
  searchRequest,
}: {
  data: OverviewData | null;
  loading: boolean;
  ready: boolean;
  reason: OverviewReason | null;
  error: string | null;
  analyzing: boolean;
  showInteractionRank: boolean;
  showHeatmap: boolean;
  topics: TopicPanelProps;
  customReports: CustomReport[];
  onRemoveReport: (id: string) => void;
  onOpenAddReport: () => void;
  searchRequest?: MessageSearchRequest | null;
}) {
  // First-load spinner: only when we genuinely have no data and aren't yet
  // streaming progress — avoids showing two contradictory blocks at once.
  if ((loading || analyzing) && !data) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-center">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {analyzing ? '首次同步进行中，可继续操作其它 tab' : '加载中…'}
        </p>
      </div>
    );
  }
  if (!data) {
    return <NotReadyBlock ready={ready} reason={reason} error={error} />;
  }

  const personalRows = data.rows.filter((r) => !r.isGroup);
  const groupRows = data.rows.filter((r) => r.isGroup);

  return (
    <>
      <MetricGrid
        peopleCount={data.totals.activeChats}
        messageCount={data.totals.messagesInWindow}
        silentCount={data.totals.silentCount}
      />

      <MessageSearchPanel searchRequest={searchRequest} />

      {showInteractionRank ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <PanelBlock title="互动 Top · 私聊" description="只统计跟单个人的对话">
            <InteractionRank rows={personalRows} limit={8} />
          </PanelBlock>
          <PanelBlock title="活跃 Top · 群聊" description="按群消息量排，群聊和私聊量级不同所以分开">
            <InteractionRank rows={groupRows} limit={8} />
          </PanelBlock>
        </div>
      ) : null}

      {topics.showTopics ? (
        <PanelBlock title="近期话题" description="每天 04:00 切日归档；按日期范围和消息来源查看话题">
          <div className="flex flex-col gap-4">
            <TopicRangeControls
              from={topics.dateFrom}
              to={topics.dateTo}
              onChange={topics.onDateRangeChange}
            />
            <div className="grid gap-6 lg:grid-cols-2">
              <TopicPanel
                scope="personal"
                summary={topics.personalSummary}
                progress={topics.personalProgress}
                whitelistCount={topics.whitelistPersonalCount}
                hasProvider={topics.hasProvider}
                onRun={topics.onRunPersonal}
                onConfigure={topics.onConfigureTopics}
              />
              <TopicPanel
                scope="group"
                summary={topics.groupSummary}
                progress={topics.groupProgress}
                whitelistCount={topics.whitelistGroupsCount}
                hasProvider={topics.hasProvider}
                onRun={topics.onRunGroup}
                onConfigure={topics.onConfigureTopics}
              />
            </div>
          </div>
        </PanelBlock>
      ) : null}

      {showHeatmap ? (
        <PanelBlock title="久未联系" description="按上次说话时间倒序，柱高代表最近 14 天的消息量">
          <SilentList rows={personalRows} nowMs={data.generatedAt} limit={12} />
        </PanelBlock>
      ) : null}

      {customReports.length > 0 ? (
        <PanelBlock
          title="自定义报表"
          right={`${customReports.length} 张 · 来自你的指令`}
        >
          <div className="flex flex-col gap-4">
            {customReports.map((r) => (
              <CustomReportCard
                key={r.id}
                report={r}
                data={data}
                onRemove={onRemoveReport}
              />
            ))}
          </div>
        </PanelBlock>
      ) : null}

      <AddReportEntry hasReports={customReports.length > 0} onClick={onOpenAddReport} />
    </>
  );
}

function TopicRangeControls({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}) {
  const applyPreset = (days: number) => {
    onChange({ from: addDays(to, -(days - 1)), to });
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="xs" onClick={() => applyPreset(7)}>
          近 7 天
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={() => applyPreset(14)}>
          近 14 天
        </Button>
        <Button type="button" variant="outline" size="xs" onClick={() => applyPreset(30)}>
          近 30 天
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <input
          type="date"
          value={from}
          onChange={(event) => onChange({ from: event.target.value, to })}
          className="h-7 rounded-md border bg-background px-2 text-xs text-foreground"
        />
        <span>至</span>
        <input
          type="date"
          value={to}
          onChange={(event) => onChange({ from, to: event.target.value })}
          className="h-7 rounded-md border bg-background px-2 text-xs text-foreground"
        />
      </div>
    </div>
  );
}

function addDays(date: string, delta: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(year, month - 1, day, 12, 0, 0, 0);
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function NotReadyBlock({
  ready,
  reason,
  error,
}: {
  ready: boolean;
  reason: OverviewReason | null;
  error: string | null;
}) {
  const hint = ready ? '暂无可分析的消息样本。' : reasonHint(reason);
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed text-center">
      <AlertCircle className="size-5 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{hint}</p>
      {error ? <p className="text-[11px] text-muted-foreground">{error}</p> : null}
    </div>
  );
}

function reasonHint(reason: OverviewReason | null): string {
  switch (reason) {
    case 'consent_required':
      return '请先在页面上方的数据授权区域完成授权。';
    case 'no_key':
      return '请先在页面上方的数据授权区域恢复微信消息库密钥。';
    case 'unsupported_platform':
      return '当前平台暂不支持读取微信消息。';
    case 'no_sync_yet':
      return '尚未同步微信消息。点击「立即同步」开始。';
    case 'snapshot_failed':
      return '分析失败，稍后重试。';
    default:
      return '尚未就绪。';
  }
}

function Toolbar({
  windowDays,
  lastAnalyzedAt,
  analyzing,
  onAnalyze,
}: {
  windowDays: number;
  lastAnalyzedAt: number | null;
  analyzing: boolean;
  onAnalyze: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4 text-xs">
      <p className="text-muted-foreground">
        统计窗口 · 最近 <span className="text-foreground tabular-nums">{windowDays}</span> 天
        <span className="ml-2 text-muted-foreground/60">在「设置 · AI · 分析窗口」中调整</span>
      </p>
      <div className="flex items-center gap-3">
        {lastAnalyzedAt && !analyzing ? (
          <span className="text-muted-foreground">
            上次分析 <RelativeTime ts={lastAnalyzedAt} />
          </span>
        ) : null}
        <Button onClick={onAnalyze} disabled={analyzing} size="sm" variant="outline">
          {analyzing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {analyzing ? '概况重算中' : '重新分析概况'}
        </Button>
      </div>
    </div>
  );
}

function RelativeTime({ ts }: { ts: number }) {
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
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function MetricGrid({
  peopleCount,
  messageCount,
  silentCount,
}: {
  peopleCount: number;
  messageCount: number;
  silentCount: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-border ring-1 ring-border">
      <Metric label="活跃对象" value={peopleCount.toLocaleString('zh-CN')} />
      <Metric label="窗口内消息" value={messageCount.toLocaleString('zh-CN')} />
      <Metric
        label="14 天没说话"
        value={String(silentCount)}
        accent={silentCount > 0 ? 'amber' : undefined}
      />
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'amber';
}) {
  return (
    <div className="flex flex-col gap-2 bg-card px-6 py-5 transition-colors hover:bg-card/60">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'text-[32px] font-semibold tabular-nums leading-none tracking-tight',
          accent === 'amber' && 'text-amber-600',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function AddReportEntry({
  hasReports,
  onClick,
}: {
  hasReports: boolean;
  onClick: () => void;
}) {
  if (hasReports) {
    return (
      <Button variant="outline" size="sm" onClick={onClick} className="w-fit">
        <Plus className="size-3.5" />
        再加一个统计报表
      </Button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-center gap-3 rounded-2xl border border-dashed py-10 text-center transition-colors hover:border-foreground/40 hover:bg-muted/20"
    >
      <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-foreground group-hover:text-background">
        <Sparkles className="size-4" />
      </span>
      <span className="flex flex-col items-center gap-1">
        <span className="text-sm font-medium">告诉 Lumos 你想看什么</span>
        <span className="text-xs text-muted-foreground">
          比如「我半夜都在跟谁聊天」「我说过的承诺都兑现了吗」
        </span>
      </span>
    </button>
  );
}
