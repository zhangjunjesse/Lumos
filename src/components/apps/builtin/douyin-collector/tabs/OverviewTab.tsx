'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Library,
  Loader2,
  Play,
  RefreshCcw,
  Rss,
  Search,
} from 'lucide-react';

import { Button } from '@/components/ui/button';

import type { DouyinCollectorStatus } from '../douyin-types';
import { useJobs } from '../use-jobs';
import { useVideos, type LibraryBacklogChip } from '../use-videos';
import { useCollectSources } from '../use-collect-sources';
import { useCollectorSettings } from '../use-collector-settings';
import { useLibraryBacklog } from '../use-library-backlog';
import { BacklogActionGrid } from '../components/BacklogActionGrid';
import { HotTagsPanel } from '../components/HotTagsPanel';
import { PatrolDigest } from '../components/PatrolDigest';
import { RecentRunsPanel } from '../components/RecentRunsPanel';
import { SetupChecklist } from '../components/SetupChecklist';

export function OverviewTab({
  status,
  loading,
  onRefresh,
  onTagClick,
  onBacklogJump,
}: {
  status: DouyinCollectorStatus | null;
  loading: boolean;
  onRefresh: () => Promise<void> | void;
  onTagClick?: (tag: string) => void;
  onBacklogJump?: (key: LibraryBacklogChip) => void;
}): React.ReactElement {
  const sources = useCollectSources();
  const jobs = useJobs();
  const { videos } = useVideos('all');
  const { settings: collectorSettings, save: saveCollectorSettings } = useCollectorSettings();
  const hasLibraryCollection = !!collectorSettings?.libraryCollectionId;
  const autoTranscribe = !!collectorSettings?.autoTranscribe;
  // Tied to the same status payload's library numbers — when totals change
  // (videos count) we re-poll the backlog to keep it accurate.
  const backlogVersion = status?.library?.videos ?? 0;
  const { counts: backlog } = useLibraryBacklog(backlogVersion);

  // Manual "run all patrols now" — fires both creator + keyword patrols
  // serially via the server-side helper. Same code path as the scheduled
  // automation runner; respects cadence gate & fatal short-circuit.
  const [patrolBusy, setPatrolBusy] = React.useState(false);
  const [patrolFeedback, setPatrolFeedback] = React.useState<string | null>(null);
  // Auto-dismiss the inline feedback after 8s — long enough to read,
  // short enough that it doesn't litter the UI when user moves on.
  React.useEffect(() => {
    if (!patrolFeedback) return;
    const id = setTimeout(() => setPatrolFeedback(null), 8000);
    return () => clearTimeout(id);
  }, [patrolFeedback]);
  const triggerPatrol = React.useCallback(async () => {
    setPatrolBusy(true);
    setPatrolFeedback(null);
    try {
      const res = await fetch('/api/apps/builtin/douyin-collector/library/run-patrol', {
        method: 'POST',
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        creators?: { message?: string };
        keywords?: { message?: string };
        error?: string;
      };
      if (json.ok) {
        const parts = [json.creators?.message, json.keywords?.message].filter(Boolean);
        setPatrolFeedback(parts.join(' · ') || '巡更已触发。');
        await onRefresh();
      } else {
        setPatrolFeedback(`失败：${json.error ?? '未知错误'}`);
      }
    } catch (err) {
      setPatrolFeedback(`失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPatrolBusy(false);
    }
  }, [onRefresh]);

  const recentJobs = jobs.jobs.slice(0, 5);
  const recentVideos = videos.slice(0, 4);

  const cookieHealth = deriveCookieHealth(status);

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">概况</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            订阅、采集队列、资料库的实时映射 — 每一个数都来自 SQLite，无 mock 数据。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Round 169: patrol is back online via the embedded
              BrowserManager path (Round 167 creators + Round 169
              keywords). Both still need the user's douyin cookie set in
              Settings — without it, patrol fails honestly with a
              "set cookie first" pointer rather than silently doing
              nothing. Disabled when 0 subs (nothing to patrol). */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void triggerPatrol()}
            disabled={
              patrolBusy ||
              (status?.sources?.creatorsEnabled ?? 0) +
                (status?.sources?.keywordsEnabled ?? 0) === 0
            }
            title="对所有启用的博主 / 关键词跑一次巡更（受 cadence 间隔约束）。前提：设置好抖音 Cookie。"
          >
            {patrolBusy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            立即巡更
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void onRefresh();
              void sources.refresh();
              void jobs.refresh();
            }}
            disabled={loading}
          >
            <RefreshCcw className="size-3.5" />
            刷新
          </Button>
        </div>
      </header>
      {patrolFeedback ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {patrolFeedback}
        </p>
      ) : null}

      <SetupChecklist
        status={status}
        hasLibraryCollection={hasLibraryCollection}
        autoTranscribe={autoTranscribe}
        onEnableAutoTranscribe={async () => {
          await saveCollectorSettings({ autoTranscribe: true });
        }}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Rss className="size-4" />}
          title="博主订阅"
          value={status?.sources?.creators ?? sources.creators.length}
        />
        <KpiCard
          icon={<Search className="size-4" />}
          title="关键词订阅"
          value={status?.sources?.keywords ?? sources.keywords.length}
        />
        <KpiCard
          icon={<Clock className="size-4" />}
          title="队列中任务"
          value={
            (status?.queue?.runningJobs ?? 0) + (status?.queue?.pendingJobs ?? 0)
          }
        />
        <KpiCard
          icon={<Library className="size-4" />}
          title="待整理草稿"
          value={status?.library?.drafts ?? 0}
        />
      </div>

      {/* ASR spend ribbon — only when there's actual spend on file. PM
          visibility: answers "did this transcribe a lot of stuff cost
          much?" without the user opening cloud billing. */}
      {(status?.asrSpend?.videoCount ?? 0) > 0 ? (
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-md border border-border bg-card px-4 py-2 text-xs text-muted-foreground">
          <span>
            <span className="text-foreground tabular-nums">
              ¥{(status?.asrSpend?.totalAmount ?? 0).toFixed(2)}
            </span>{' '}
            ASR 累计花费 · {status?.asrSpend?.videoCount} 条
          </span>
          {(status?.asrSpend?.last30dVideoCount ?? 0) > 0 ? (
            <span>
              近 30 天{' '}
              <span className="text-foreground tabular-nums">
                ¥{(status?.asrSpend?.last30dAmount ?? 0).toFixed(2)}
              </span>{' '}
              · {status?.asrSpend?.last30dVideoCount} 条
            </span>
          ) : null}
        </div>
      ) : null}

      {onBacklogJump ? (
        <BacklogActionGrid counts={backlog} onJump={onBacklogJump} />
      ) : null}

      <PatrolDigest
        refreshTick={backlogVersion}
        hidden={(status?.library?.videos ?? 0) === 0}
        onTagClick={onTagClick}
      />

      {status?.queue?.lastRunFailure ? (
        <div className="flex items-start gap-2 rounded-xl border border-amber-300/40 bg-amber-50 px-4 py-3 text-sm dark:border-amber-300/20 dark:bg-amber-950/30">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0">
            <p className="font-medium">最近一次任务失败</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {status.queue.lastRunFailure}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="最近采集">
          {recentJobs.length === 0 ? (
            <EmptyHint text="还没有采集任务。" />
          ) : (
            <ul className="divide-y divide-border">
              {recentJobs.map((j) => (
                <li
                  key={j.id}
                  className="flex items-center justify-between gap-3 py-2 text-xs"
                >
                  <span className="truncate">
                    {j.kind === 'creator' ? '博主' : j.kind === 'keyword' ? '关键词' : '链接'} ·{' '}
                    {j.target_ref.slice(0, 18)}…
                  </span>
                  <span className={statusTone(j.status)}>{j.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="最近资料">
          {recentVideos.length === 0 ? (
            <EmptyHint text="资料库还是空的。下一轮接入抓取后就会有内容。" />
          ) : (
            <ul className="divide-y divide-border">
              {recentVideos.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-3 py-2 text-xs"
                >
                  <span className="truncate">
                    {v.title || `aweme ${v.aweme_id?.slice(0, 8) ?? ''}…`}
                  </span>
                  <span className="text-muted-foreground">{v.library_status ?? 'unprocessed'}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <HotTagsPanel onTagClick={onTagClick} />

      <Panel title="最近运行">
        <RecentRunsPanel />
      </Panel>

      <Panel title="健康度">
        {/* Only actionable signals here — anything that's a static "feature
            implemented" line belongs in docs, not in a health panel. Each
            row maps to a specific setting the user can flip. */}
        <ul className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          {/* Cookie health: "configured" alone is misleading — a stale
              cookie shows ✅ until next patrol fires. Show last-ok age so
              the user knows whether it's still working. >7d = warning. */}
          <HealthLine
            ok={cookieHealth.ok}
            okText={cookieHealth.okText ?? '抖音 Cookie 已配置（博主 / 关键词巡更可用）'}
            failText={cookieHealth.failText ?? '未配抖音 Cookie：博主 / 关键词巡更不可用，仅能粘单条链接采集。'}
            failHref="/apps/douyin-collector?tab=settings"
            failHrefLabel={cookieHealth.failHrefLabel ?? '去配 Cookie'}
          />
          <HealthLine
            ok={status?.transcribe?.asrReady ?? false}
            okText="字幕兜底就绪：原生 VTT/JSON + 云端语音 ASR"
            failText={
              status?.transcribe?.cloudLoggedIn === false
                ? '语音 ASR 未就绪：未登录 Lumos 云账户。无原生字幕的视频会停在「未转写」。'
                : status?.transcribe?.speechProviderConfigured === false
                  ? '语音 ASR 未就绪：未选语音服务商。无原生字幕的视频会停在「未转写」。'
                  : '语音 ASR 未就绪。无原生字幕的视频会停在「未转写」。'
            }
            failHref="/settings#providers"
            failHrefLabel={
              status?.transcribe?.cloudLoggedIn === false ? '去登录' : '去选服务商'
            }
          />
          <HealthLine
            ok={hasLibraryCollection}
            okText="入库目标已选定"
            failText="未选入库 collection：转写完的视频无处可发布。"
            failHref="/knowledge"
            failHrefLabel="去新建 / 选集合"
          />
          <HealthLine
            ok={(status?.sources?.creators ?? 0) + (status?.sources?.keywords ?? 0) > 0}
            okText={`已订阅 ${(status?.sources?.creators ?? 0) + (status?.sources?.keywords ?? 0)} 个来源`}
            failText="尚未订阅任何博主或关键词（粘链接逐条入库不需要订阅）。"
          />
        </ul>
      </Panel>
    </section>
  );
}

function KpiCard({
  icon,
  title,
  value,
}: {
  icon: React.ReactNode;
  title: string;
  value: number;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }): React.ReactElement {
  return <p className="text-xs text-muted-foreground">{text}</p>;
}

function HealthLine({
  ok,
  okText,
  failText,
  failHref,
  failHrefLabel,
}: {
  ok: boolean;
  okText?: string;
  failText?: string;
  failHref?: string;
  failHrefLabel?: string;
}): React.ReactElement {
  return (
    <li className="flex items-start gap-2">
      {ok ? (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
      ) : (
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
      )}
      <span className={ok ? 'text-foreground' : 'text-muted-foreground'}>
        {ok ? okText ?? '正常' : failText}
        {!ok && failHref ? (
          <>
            {' '}
            <Link
              href={failHref}
              className="text-foreground underline-offset-2 hover:underline"
            >
              {failHrefLabel ?? '去配置'} →
            </Link>
          </>
        ) : null}
      </span>
    </li>
  );
}

function statusTone(status: string): string {
  switch (status) {
    case 'success':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'failed':
      return 'text-rose-600 dark:text-rose-400';
    case 'running':
      return 'text-amber-600 dark:text-amber-400';
    default:
      return 'text-muted-foreground';
  }
}

const STALE_COOKIE_DAYS = 7;

/**
 * Cookie freshness derivation. "Configured" alone (= non-empty string) is
 * not a real health signal — a stale cookie that hasn't been validated in
 * weeks still shows ✅. We surface a warning when cookieLastOkAt is older
 * than 7 days so the user can rotate before the next patrol fails.
 */
function deriveCookieHealth(status: DouyinCollectorStatus | null): {
  ok: boolean;
  okText?: string;
  failText?: string;
  failHrefLabel?: string;
} {
  const configured = !!status?.auth?.cookieValid;
  if (!configured) {
    return { ok: false };
  }
  const lastOkAt = status?.auth?.lastOkAt;
  if (!lastOkAt) {
    // Configured but never successfully probed yet. Don't claim ✓ until
    // a probe confirms — first patrol or "测试 Cookie" will resolve.
    return {
      ok: false,
      failText: '抖音 Cookie 已配置但还没探测过有效性。点设置里的「测试 Cookie」或等待下一次巡更。',
      failHrefLabel: '去测试 Cookie',
    };
  }
  const lastOkMs = Date.parse(lastOkAt);
  if (!Number.isFinite(lastOkMs)) {
    return { ok: true };
  }
  const ageDays = Math.floor((Date.now() - lastOkMs) / (24 * 60 * 60_000));
  if (ageDays >= STALE_COOKIE_DAYS) {
    return {
      ok: false,
      failText: `抖音 Cookie 上次成功探测是 ${ageDays} 天前 — 抖音的登录态通常 7-14 天就会失效。失败前主动换一次。`,
      failHrefLabel: '去更新 Cookie',
    };
  }
  return {
    ok: true,
    okText:
      ageDays === 0
        ? '抖音 Cookie 已配置（今天验证过 · 巡更可用）'
        : `抖音 Cookie 已配置（${ageDays} 天前验证过 · 巡更可用）`,
  };
}
