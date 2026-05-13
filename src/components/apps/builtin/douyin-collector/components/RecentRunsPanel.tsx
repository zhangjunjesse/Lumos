'use client';

import * as React from 'react';

import { useAppCollection } from '../use-app-data';
import { relativeAge } from '@/lib/douyin-collector/relative-age';

interface RunHistoryRow {
  id: string;
  title?: string;
  status?: 'running' | 'success' | 'failed' | 'cancelled';
  summary?: string;
  failure_reason?: string;
  updated_at?: string;
}

interface JobRow {
  id: string;
  kind?: string;
  target_ref?: string;
  status?: string;
  failure_reason?: string;
  updated_at?: string;
}

interface MergedRun {
  key: string;
  title: string;
  status: string;
  summary: string;
  failureReason: string | null;
  at: string | null;
  source: 'automation' | 'collect';
}

const STATUS_TONE: Record<string, string> = {
  success: 'text-emerald-600 dark:text-emerald-400',
  failed: 'text-rose-600 dark:text-rose-400',
  running: 'text-amber-600 dark:text-amber-400',
  cancelled: 'text-muted-foreground line-through',
  queued: 'text-muted-foreground',
};

export function RecentRunsPanel(): React.ReactElement {
  const runs = useAppCollection<RunHistoryRow>('run_history', {
    sortKey: 'updated_at',
    sortDir: 'desc',
  });
  const jobs = useAppCollection<JobRow>('collect_jobs', {
    sortKey: 'updated_at',
    sortDir: 'desc',
  });
  const [expanded, setExpanded] = React.useState(false);
  const visibleLimit = expanded ? 60 : 12;

  const merged = React.useMemo<MergedRun[]>(() => {
    // Pull both collections at the same depth so the merged set has
    // enough candidates to fill `visibleLimit` after the chronological
    // sort. 60 covers the expanded view; with each side capped at 60
    // and timestamp-merged, we're never short.
    const cap = Math.max(60, visibleLimit);
    const a: MergedRun[] = runs.rows.slice(0, cap).map((r) => ({
      key: `r:${r.id}`,
      title: r.title ?? '运行',
      status: r.status ?? 'unknown',
      summary: r.summary ?? '',
      failureReason: r.failure_reason ?? null,
      at: r.updated_at ?? null,
      source: 'automation',
    }));
    const b: MergedRun[] = jobs.rows.slice(0, cap).map((j) => ({
      key: `j:${j.id}`,
      title: `${kindLabel(j.kind)} · ${(j.target_ref ?? '').slice(0, 24)}`,
      status: j.status ?? 'unknown',
      summary: '',
      failureReason: j.failure_reason ?? null,
      at: j.updated_at ?? null,
      source: 'collect',
    }));
    return [...a, ...b]
      .sort((x, y) => (y.at ?? '').localeCompare(x.at ?? ''))
      .slice(0, visibleLimit);
  }, [runs.rows, jobs.rows, visibleLimit]);

  if (runs.loading || jobs.loading) {
    return (
      <p className="text-xs text-muted-foreground">加载运行结果…</p>
    );
  }

  if (merged.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        还没有运行记录。点博主或关键词的「立即采集」试一次。
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {merged.map((row) => (
        <li key={row.key} className="flex items-start justify-between gap-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <div className="truncate">
              <span className="font-medium">{row.title}</span>
              {row.summary ? (
                <span className="ml-2 text-muted-foreground">{row.summary}</span>
              ) : null}
            </div>
            {row.failureReason ? (
              <p className="mt-0.5 truncate text-rose-500">{row.failureReason}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {row.at ? (
              <span
                className="text-[10px] tabular-nums text-muted-foreground"
                title={new Date(row.at).toLocaleString('zh-CN')}
              >
                {relativeAge(row.at).label}
              </span>
            ) : null}
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {row.source === 'automation' ? '自动化' : '采集'}
            </span>
            <span
              className={`uppercase tracking-wider ${STATUS_TONE[row.status] ?? 'text-muted-foreground'}`}
            >
              {row.status}
            </span>
          </div>
        </li>
      ))}
      {merged.length >= 12 ? (
        <li className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded
              ? `收起 (显示前 12 条)`
              : `展开（显示前 60 条）`}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

function kindLabel(kind?: string): string {
  switch (kind) {
    case 'creator':
      return '博主';
    case 'keyword':
      return '关键词';
    case 'link':
      return '链接';
    default:
      return '采集';
  }
}
