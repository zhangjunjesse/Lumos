'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { relativeAge } from '@/lib/douyin-collector/relative-age';

import type { useCollectSources } from '../../use-collect-sources';
import type { useJobs } from '../../use-jobs';

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
};

type JobFilter = 'all' | 'active' | 'success' | 'failed';

const PAGE_SIZE = 8;
const FILTER_TABS: Array<{ value: JobFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '进行中' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败/取消' },
];

export function RecentJobsPanel({
  jobs,
  sources,
}: {
  jobs: ReturnType<typeof useJobs>;
  sources: ReturnType<typeof useCollectSources>;
}): React.ReactElement {
  const [filter, setFilter] = React.useState<JobFilter>('all');
  const [page, setPage] = React.useState(1);
  const counts = React.useMemo(() => {
    const next: Record<JobFilter, number> = {
      all: jobs.jobs.length,
      active: 0,
      success: 0,
      failed: 0,
    };
    for (const job of jobs.jobs) {
      if (job.status === 'queued' || job.status === 'running') next.active += 1;
      else if (job.status === 'success') next.success += 1;
      else if (job.status === 'failed' || job.status === 'cancelled') next.failed += 1;
    }
    return next;
  }, [jobs.jobs]);
  const filteredJobs = React.useMemo(
    () => jobs.jobs.filter((job) => matchesJobFilter(job.status, filter)),
    [filter, jobs.jobs],
  );
  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageJobs = filteredJobs.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const rangeStart = filteredJobs.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, filteredJobs.length);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">最近采集任务</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            实时任务队列；按状态分组分页显示，每条都展示运行时间和失败原因。
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          共 {filteredJobs.length} 条
          {filteredJobs.length > 0 ? ` · ${rangeStart}-${rangeEnd}` : ''}
        </div>
      </div>
      <Tabs
        value={filter}
        onValueChange={(value) => {
          setFilter(value as JobFilter);
          setPage(1);
        }}
        className="mt-4"
      >
        <TabsList className="h-auto max-w-full flex-wrap justify-start">
          {FILTER_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
              {tab.label}
              <span className="rounded bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {counts[tab.value]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="mt-3 divide-y divide-border">
        {pageJobs.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            {jobs.jobs.length === 0
              ? '还没有采集任务。点博主/关键词卡片右侧的「立即采集」试试。'
              : '当前分组没有采集任务。'}
          </p>
        ) : (
          pageJobs.map((j) => (
            <JobRow
              key={j.id}
              job={j}
              creators={sources.creators}
              keywords={sources.keywords}
              onRetry={jobs.retry}
              onCancel={jobs.cancel}
              onDeleteCreator={sources.deleteCreator}
            />
          ))
        )}
      </div>
      {filteredJobs.length > PAGE_SIZE ? (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            第 {currentPage} / {totalPages} 页
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="size-3.5" />
              上一页
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              disabled={currentPage >= totalPages}
            >
              下一页
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function matchesJobFilter(status: string, filter: JobFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return status === 'queued' || status === 'running';
  if (filter === 'success') return status === 'success';
  return status === 'failed' || status === 'cancelled';
}

function JobRow({
  job,
  creators,
  keywords,
  onRetry,
  onCancel,
  onDeleteCreator,
}: {
  job: ReturnType<typeof useJobs>['jobs'][number];
  creators: ReturnType<typeof useCollectSources>['creators'];
  keywords: ReturnType<typeof useCollectSources>['keywords'];
  onRetry: (id: string) => Promise<void> | void;
  onCancel: (id: string) => Promise<void> | void;
  onDeleteCreator: (id: string) => Promise<void> | void;
}): React.ReactElement {
  let target = '';
  let creator: (typeof creators)[number] | undefined;
  if (job.kind === 'creator') {
    creator = creators.find((row) => row.id === job.target_ref);
    target = creator ? `博主 · ${creator.nickname}` : `博主 · ${job.target_ref.slice(0, 8)}…`;
  } else if (job.kind === 'keyword') {
    const k = keywords.find((row) => row.id === job.target_ref);
    target = k ? `关键词 · ${k.query}` : `关键词 · ${job.target_ref.slice(0, 12)}…`;
  } else {
    target = `链接 · ${job.target_ref.slice(0, 32)}`;
  }

  const tone =
    job.status === 'success'
      ? 'text-emerald-600 dark:text-emerald-400'
      : job.status === 'failed'
        ? 'text-rose-600 dark:text-rose-400'
        : job.status === 'running'
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-muted-foreground';
  const canCancel = job.status === 'queued' || job.status === 'running';
  const isLegacyCreatorWithoutSecUid =
    job.kind === 'creator' &&
    !creator?.sec_uid &&
    !!job.failure_reason?.includes('sec_uid');
  const canRetry =
    !isLegacyCreatorWithoutSecUid && (job.status === 'failed' || job.status === 'cancelled');
  const timeIso = job.ended_at || job.started_at || job.updated_at || null;
  const age = relativeAge(timeIso ?? null);
  const absoluteTime = formatAbsoluteTime(timeIso);
  const statusLabel = STATUS_LABELS[job.status] ?? job.status;
  const fullModeLabel =
    job.kind === 'creator' && job.creator_collect_mode === 'full'
      ? ` · 全量模式${typeof job.max_videos === 'number' ? `（最多 ${job.max_videos}）` : ''}`
      : '';
  return (
    <div className="flex items-start justify-between gap-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <div className="min-w-0 truncate font-medium">{target}</div>
          <div
            className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground"
            title={absoluteTime}
          >
            <Clock3 className="size-3" />
            {absoluteTime === '时间未知' ? age.label : `${age.label} · ${absoluteTime}`}
          </div>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          发现 {job.discovered_count} · 转写 {job.transcribed_count}
          {fullModeLabel}
        </div>
        {job.failure_reason ? (
          <div className="mt-1 max-w-full text-xs leading-5 text-rose-500">
            <span className="font-medium">失败原因：</span>
            <span className="break-words">{job.failure_reason}</span>
            {isLegacyCreatorWithoutSecUid ? (
              <span className="text-muted-foreground">
                {' '}
                这类旧记录不能靠重试恢复，需要在博主订阅里删除后，用抖音主页分享链接重加。
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`whitespace-nowrap text-xs font-medium ${tone}`}>
          {statusLabel}
        </span>
        {canRetry ? (
          <Button size="sm" variant="ghost" onClick={() => void onRetry(job.id)}>
            重试
          </Button>
        ) : null}
        {isLegacyCreatorWithoutSecUid && creator ? (
          <Button size="sm" variant="ghost" onClick={() => void onDeleteCreator(creator.id)}>
            删除旧订阅
          </Button>
        ) : null}
        {canCancel ? (
          <Button size="sm" variant="ghost" onClick={() => void onCancel(job.id)}>
            取消
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function formatAbsoluteTime(iso: string | null): string {
  if (!iso) return '时间未知';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}
