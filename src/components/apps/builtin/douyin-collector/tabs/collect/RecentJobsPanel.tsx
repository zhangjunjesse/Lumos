'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';

import type { useCollectSources } from '../../use-collect-sources';
import type { useJobs } from '../../use-jobs';

export function RecentJobsPanel({
  jobs,
  sources,
}: {
  jobs: ReturnType<typeof useJobs>;
  sources: ReturnType<typeof useCollectSources>;
}): React.ReactElement {
  const recent = jobs.jobs.slice(0, 8);
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold tracking-tight">最近采集任务</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        实时任务队列；失败原因诚实暴露，不会用 mock 数据冒充成功。
      </p>
      <div className="mt-3 divide-y divide-border">
        {recent.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            还没有采集任务。点博主/关键词卡片右侧的「立即采集」试试。
          </p>
        ) : (
          recent.map((j) => (
            <JobRow
              key={j.id}
              job={j}
              creators={sources.creators}
              keywords={sources.keywords}
              onRetry={jobs.retry}
              onCancel={jobs.cancel}
            />
          ))
        )}
      </div>
    </div>
  );
}

function JobRow({
  job,
  creators,
  keywords,
  onRetry,
  onCancel,
}: {
  job: ReturnType<typeof useJobs>['jobs'][number];
  creators: ReturnType<typeof useCollectSources>['creators'];
  keywords: ReturnType<typeof useCollectSources>['keywords'];
  onRetry: (id: string) => Promise<void> | void;
  onCancel: (id: string) => Promise<void> | void;
}): React.ReactElement {
  let target = '';
  if (job.kind === 'creator') {
    const c = creators.find((row) => row.id === job.target_ref);
    target = c ? `博主 · ${c.nickname}` : `博主 · ${job.target_ref.slice(0, 8)}…`;
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
  const canRetry = job.status === 'failed' || job.status === 'cancelled';
  return (
    <div className="flex items-start justify-between gap-3 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{target}</div>
        {job.failure_reason ? (
          <div className="mt-0.5 text-xs text-rose-500">{job.failure_reason}</div>
        ) : (
          <div className="mt-0.5 text-xs text-muted-foreground">
            发现 {job.discovered_count} · 转写 {job.transcribed_count}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`whitespace-nowrap text-xs uppercase tracking-wider ${tone}`}>
          {job.status}
        </span>
        {canRetry ? (
          <Button size="sm" variant="ghost" onClick={() => void onRetry(job.id)}>
            重试
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
