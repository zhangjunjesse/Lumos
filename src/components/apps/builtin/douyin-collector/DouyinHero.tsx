'use client';

import * as React from 'react';
import {
  Video,
  Clock,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';

import type { DouyinCollectorStatus } from './douyin-types';
import { relativeAge } from '@/lib/douyin-collector/relative-age';

const COOKIE_STALE_HOURS = 36;
const PATROL_STALE_HOURS = 36;

const PHASE_LABEL: Record<string, string> = {
  not_configured: '尚未配置',
  'needs-install': '应用未安装',
  needs_auth: '需要登录抖音 Cookie',
  ready: '已就绪',
  syncing: '采集进行中',
  failed: '上次运行失败',
};

export function DouyinHero({
  status,
  loading,
}: {
  status: DouyinCollectorStatus | null;
  loading: boolean;
}): React.ReactElement {
  const phase = status?.phase ?? (loading ? 'loading' : 'not_configured');
  const phaseText = phase === 'loading' ? '检测中…' : PHASE_LABEL[phase] ?? phase;
  const ready = !!status?.ready;
  const failure = status?.queue?.lastRunFailure;

  const tone: 'ok' | 'warn' | 'fail' =
    ready ? 'ok' : phase === 'failed' ? 'fail' : 'warn';

  // Cookie aging signal — surfaces the auto-probe (Round 87) result so
  // user notices a stale auth without opening Settings.
  const cookieAge = relativeAge(status?.auth?.lastOkAt ?? null);
  const cookieStale =
    !!status?.auth?.cookieValid &&
    !!status?.auth?.lastOkAt &&
    cookieAge.hours !== null &&
    cookieAge.hours >= COOKIE_STALE_HOURS;

  // Patrol freshness — uses lastPatrolAt (collect_jobs only), NOT
  // lastRunAt (any event). Round 149 split: a manual transcribe (which
  // updates run_history → lastRunAt) must NOT reset the patrol-stale
  // timer; otherwise broken-cadence schedules go unflagged. Falls back
  // to lastRunAt for older clients that don't surface lastPatrolAt yet.
  const patrolAtRaw = status?.queue?.lastPatrolAt ?? status?.queue?.lastRunAt ?? null;
  const lastPatrolAge = relativeAge(patrolAtRaw);
  // Last publish time — most recent video that hit library_status='published'.
  // Surfaces the "深度学习" velocity signal: if patrol is daily but publish
  // is weeks ago, user is collecting but not curating.
  const lastPublishAge = relativeAge(status?.library?.lastPublishedAt ?? null);
  // Stale patrol: only warn when there's an active schedule (≥1 enabled
  // subscription with non-manual cadence). A user with all-manual subs
  // shouldn't be told their patrol is "late".
  const patrolStale =
    !!status?.sources?.hasActiveSchedule &&
    !!patrolAtRaw &&
    lastPatrolAge.hours !== null &&
    lastPatrolAge.hours >= PATROL_STALE_HOURS;

  return (
    <div className="flex items-start gap-3 border-b bg-card px-10 py-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-500 text-white">
        <Video className="size-4" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h1 className="text-base font-semibold tracking-tight">抖音采集器</h1>
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            内置 · 知识采集
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          按博主或关键词采集抖音视频，抓字幕、做摘要、入知识库；长视频自动分段转写。
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <PhaseDot tone={tone} loading={loading} />
            <span className="text-foreground">{phaseText}</span>
          </span>
          {status?.sources ? (
            <SourcesPill sources={status.sources} />
          ) : null}
          {status?.library ? (
            <span className="text-muted-foreground tabular-nums">
              · 资料 {status.library.videos}（草稿 {status.library.drafts} · 已入库{' '}
              {status.library.published}）
            </span>
          ) : null}
          {status?.library?.lastPublishedAt ? (
            <span
              className="inline-flex items-center gap-1 text-muted-foreground"
              title={`上次入库：${new Date(status.library.lastPublishedAt).toLocaleString('zh-CN')}`}
            >
              <CheckCircle2 className="size-3.5" />
              入库 {lastPublishAge.label}
            </span>
          ) : null}
          {patrolAtRaw ? (
            <span
              className={
                patrolStale
                  ? 'inline-flex items-center gap-1 text-amber-600 dark:text-amber-400'
                  : 'inline-flex items-center gap-1 text-muted-foreground'
              }
              title={
                patrolStale
                  ? `调度可能失效：上次采集 ${lastPatrolAge.label}，但你启用了非手动 cadence 的订阅。检查 /workflow 调度状态。`
                  : `上次采集任务：${new Date(patrolAtRaw).toLocaleString('zh-CN')}`
              }
            >
              <Clock className="size-3.5" />
              巡更 {lastPatrolAge.label}
              {patrolStale ? ' · 调度可能失效' : ''}
            </span>
          ) : (status?.sources?.creators ?? 0) + (status?.sources?.keywords ?? 0) > 0 ? (
            <span
              className="inline-flex items-center gap-1 text-muted-foreground"
              title="尚未触发任何采集任务；试试单条订阅的「立即采集」按钮。"
            >
              <Clock className="size-3.5" />
              尚未巡更
            </span>
          ) : null}
          {status?.auth?.cookieValid && status.auth.lastOkAt ? (
            <span
              className={
                cookieStale
                  ? 'inline-flex items-center gap-1 text-amber-600 dark:text-amber-400'
                  : 'inline-flex items-center gap-1 text-muted-foreground'
              }
              title={
                cookieStale
                  ? `Cookie 已 ${cookieAge.label} 未通过自动探测；可能已过期。`
                  : `Cookie 上次自动探测 OK：${cookieAge.label}前。`
              }
            >
              <KeyRound className="size-3.5" />
              Cookie {cookieAge.label}
              {cookieStale ? ' · 建议刷新' : ''}
            </span>
          ) : null}
          {failure ? (
            <span
              className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
              title={
                status?.queue?.lastRunAt
                  ? `${failure}\n发生于：${new Date(status.queue.lastRunAt).toLocaleString('zh-CN')}`
                  : failure
              }
            >
              <AlertTriangle className="size-3.5" />
              {failure.length > 40 ? `${failure.slice(0, 40)}…` : failure}
              {status?.queue?.lastRunAt
                ? ` · ${relativeAge(status.queue.lastRunAt).label}`
                : ''}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Render the source-count line. Shows total counts; if any subscription
 * is disabled (Switch off in CollectTab), append the disabled count in
 * a softer tone so the user sees their *active* surface honestly.
 *
 * Pre-Round-148 behavior was "订阅 10 博主" even when 8 were paused —
 * misleading. Now: "订阅 10 博主（2 已停用）" only when disabled > 0.
 */
function SourcesPill({
  sources,
}: {
  sources: NonNullable<DouyinCollectorStatus['sources']>;
}): React.ReactElement {
  const cDis =
    typeof sources.creatorsEnabled === 'number'
      ? sources.creators - sources.creatorsEnabled
      : 0;
  const kDis =
    typeof sources.keywordsEnabled === 'number'
      ? sources.keywords - sources.keywordsEnabled
      : 0;
  const total = sources.creators + sources.keywords;
  const totalDis = cDis + kDis;
  const tooltip = totalDis > 0
    ? `已启用 ${total - totalDis}/${total}（停用：${cDis} 博主 + ${kDis} 关键词）；停用的订阅不会自动巡更，但保留历史数据。`
    : '所有订阅都启用，自动巡更按各自 cadence 触发。';
  return (
    <span className="text-muted-foreground tabular-nums" title={tooltip}>
      · 订阅 {sources.creators} 博主 / {sources.keywords} 关键词
      {totalDis > 0 ? (
        <span className="ml-1 text-amber-600/80 dark:text-amber-400/80">
          （{totalDis} 已停用）
        </span>
      ) : null}
    </span>
  );
}

function PhaseDot({
  tone,
  loading,
}: {
  tone: 'ok' | 'warn' | 'fail';
  loading: boolean;
}): React.ReactElement {
  if (loading) return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />;
  if (tone === 'ok') return <ShieldCheck className="size-3.5 text-emerald-500" />;
  if (tone === 'fail') return <AlertTriangle className="size-3.5 text-rose-500" />;
  return <span className="size-2 rounded-full bg-amber-500" aria-hidden />;
}
