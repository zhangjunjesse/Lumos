'use client';

import * as React from 'react';
import { AlertTriangle, Sparkles, Tag, Users, Video } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { useActivityDigest } from '../use-activity-digest';

const WINDOW_OPTIONS = [
  { hours: 24, label: '过去 24h' },
  { hours: 24 * 7, label: '过去 7 天' },
  { hours: 24 * 30, label: '过去 30 天' },
] as const;

/**
 * Time-bounded "什么变了" panel for the Overview tab. Hidden when the
 * library is empty — first-run users see SetupChecklist instead. Visible
 * after the first patrol fires; toggle between 24h / 7d / 30d windows.
 *
 * Numbers are honest: every count comes from `summarizeRecentActivity`
 * which scans real rows (no derived/cached aggregates).
 */
const DIGEST_WINDOW_KEY = 'lumos:douyin-collector:digest-window';
const ALLOWED_HOURS = [24, 24 * 7, 24 * 30] as const;

export function PatrolDigest({
  refreshTick = 0,
  hidden = false,
  onTagClick,
}: {
  refreshTick?: number;
  hidden?: boolean;
  onTagClick?: (tag: string) => void;
}): React.ReactElement | null {
  // Persist window choice (24h / 7d / 30d) to localStorage. Returning
  // users keep their preferred view of "what's new" without resetting
  // every session. Falls back to 24h on parse error / out-of-range.
  const [hours, setHours] = React.useState<number>(() => {
    if (typeof window === 'undefined') return 24;
    try {
      const raw = window.localStorage.getItem(DIGEST_WINDOW_KEY);
      const n = Number(raw);
      if (Number.isFinite(n) && (ALLOWED_HOURS as readonly number[]).includes(n)) {
        return n;
      }
    } catch {
      /* ignore */
    }
    return 24;
  });
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(DIGEST_WINDOW_KEY, String(hours));
    } catch {
      /* localStorage may be blocked in some contexts */
    }
  }, [hours]);
  const { digest, loading } = useActivityDigest(hours, refreshTick);
  if (hidden) return null;

  const empty =
    !loading &&
    digest.newVideos === 0 &&
    digest.publishedInWindow === 0 &&
    digest.failedRuns === 0;
  if (empty) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">动态速报</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            自上次运行以来的真实变化 — 每一个数都来自 SQLite，无 mock。
          </p>
        </div>
        <div className="flex items-center gap-1">
          {WINDOW_OPTIONS.map((opt) => (
            <Button
              key={opt.hours}
              size="sm"
              variant={hours === opt.hours ? 'default' : 'ghost'}
              className="h-7 px-2.5 text-xs"
              onClick={() => setHours(opt.hours)}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          icon={<Video className="size-4" />}
          label="新增视频"
          value={digest.newVideos}
          hint={
            digest.uniqueCreators > 0
              ? `来自 ${digest.uniqueCreators} 位博主`
              : '没有新视频'
          }
        />
        <Stat
          icon={<Sparkles className="size-4" />}
          label="入库 / 已加星"
          value={digest.publishedInWindow}
          hint={
            digest.starredInWindow > 0
              ? `· ⭐ ${digest.starredInWindow} 条`
              : '加星和入库是用户主动信号'
          }
        />
        <Stat
          icon={<AlertTriangle className="size-4" />}
          label="失败运行"
          value={digest.failedRuns}
          hint={digest.failedRuns > 0 ? '查看「最近运行」面板诊断' : '无失败'}
          tone={digest.failedRuns > 0 ? 'warn' : 'default'}
        />
        <Stat
          icon={<Users className="size-4" />}
          label="活跃博主"
          value={digest.uniqueCreators}
          hint={
            digest.uniqueCreators === 0
              ? '本期没有博主产出'
              : digest.uniqueCreators === 1
                ? '只有一位博主在更新'
                : `平均 ${(digest.newVideos / digest.uniqueCreators).toFixed(1)} 条 / 博主`
          }
        />
      </div>

      {digest.newTags.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <Tag className="size-3" />
            新标签
          </span>
          {digest.newTags.map((t) =>
            onTagClick ? (
              <button
                key={t}
                type="button"
                onClick={() => onTagClick(t)}
                className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-foreground/80 transition-colors hover:bg-foreground/10 hover:text-foreground"
                title={`在资料库筛选「${t}」`}
              >
                {t}
              </button>
            ) : (
              <span
                key={t}
                className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-foreground/80"
              >
                {t}
              </span>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  tone = 'default',
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
  tone?: 'default' | 'warn';
}): React.ReactElement {
  const valueClass =
    tone === 'warn' && value > 0
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-foreground';
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className={`mt-1.5 text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</p>
      {hint ? <p className="mt-0.5 line-clamp-1 text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
