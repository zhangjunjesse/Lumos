'use client';

import * as React from 'react';
import { CheckCircle2, Loader2, RefreshCw, AlertCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { SyncProgress, SyncState } from './use-wechat-sync';

export function SyncBanner({
  state,
  progress,
  error,
  hasEverSynced,
  onSync,
  onRebuild,
  onRefresh,
}: {
  state: SyncState | null;
  progress: SyncProgress | null;
  error?: string | null;
  hasEverSynced: boolean;
  onSync: () => void;
  onRebuild: () => void;
  onRefresh?: () => void;
}): React.ReactElement | null {
  if (!state) {
    if (!error) return null;
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/5 px-4 py-3">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-rose-700 dark:text-rose-300">微信同步状态加载失败</p>
          <p className="mt-0.5 break-words text-[11px] text-muted-foreground">{error}</p>
        </div>
        {onRefresh ? (
          <Button onClick={onRefresh} variant="outline" size="sm" className="shrink-0">
            <RefreshCw className="size-3.5" />
            重试
          </Button>
        ) : null}
      </div>
    );
  }

  const running = !!state.inFlight || (!!progress && (progress.phase === 'starting' || progress.phase === 'running'));
  const errored = !!progress && progress.phase === 'error';
  const idle = !running && !errored;

  if (idle && error) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/5 px-4 py-3">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-rose-700 dark:text-rose-300">微信同步状态刷新失败</p>
          <p className="mt-0.5 break-words text-[11px] text-muted-foreground">{error}</p>
          {state.lastFinishedAt ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              仍显示上次同步状态：<RelativeFinishedAt ts={state.lastFinishedAt} />
            </p>
          ) : null}
        </div>
        {onRefresh ? (
          <Button onClick={onRefresh} variant="outline" size="sm" className="shrink-0">
            <RefreshCw className="size-3.5" />
            重试
          </Button>
        ) : null}
      </div>
    );
  }

  // Idle + ever synced + recently → don't shout, just show a tiny "上次同步 X 前" pill
  if (idle && hasEverSynced) {
    return (
      <div className="flex items-center justify-end gap-3 px-1 text-[11px] text-muted-foreground">
        <RelativeFinishedAt ts={state.lastFinishedAt} />
        <Button onClick={onSync} variant="ghost" size="sm" className="h-7 gap-1 text-[11px]">
          <RefreshCw className="size-3" />
          立即同步
        </Button>
        <Button onClick={onRebuild} variant="ghost" size="sm" className="h-7 gap-1 text-[11px] text-muted-foreground">
          清空重建
        </Button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-2xl border px-4 py-3',
        running && 'border-sky-500/30 bg-sky-500/5',
        errored && 'border-rose-500/30 bg-rose-500/5',
        idle && !hasEverSynced && 'border-amber-500/30 bg-amber-500/5',
      )}
    >
      <Icon running={running} errored={errored} firstTime={!hasEverSynced} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {running ? progress?.message ?? '同步中…' : errored ? '同步失败' : '尚未同步微信消息'}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {running
            ? renderRunningHint(progress)
            : errored
              ? progress?.message ?? state.lastError
              : '首次同步会拉取你的全部消息历史，可能需要数分钟，期间可继续操作。'}
        </p>
      </div>
      {!running ? (
        <Button onClick={onSync} variant="outline" size="sm" className="shrink-0">
          <RefreshCw className="size-3.5" />
          {hasEverSynced ? '重新同步' : '开始同步'}
        </Button>
      ) : null}
    </div>
  );
}

function Icon({
  running,
  errored,
  firstTime,
}: {
  running: boolean;
  errored: boolean;
  firstTime: boolean;
}) {
  if (running) return <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-sky-600" />;
  if (errored) return <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-600" />;
  if (firstTime) return <RefreshCw className="mt-0.5 size-4 shrink-0 text-amber-600" />;
  return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />;
}

function renderRunningHint(progress: SyncProgress | null): string {
  if (!progress) return '';
  if (progress.messagesInserted > 0) {
    return progress.currentDb
      ? `已写入 ${progress.messagesInserted.toLocaleString('zh-CN')} 条 · 当前 ${progress.currentDb}`
      : `已写入 ${progress.messagesInserted.toLocaleString('zh-CN')} 条`;
  }
  if (progress.currentDb) return `正在解码 ${progress.currentDb}`;
  return '可继续操作其它 tab，同步在后台进行';
}

function RelativeFinishedAt({ ts }: { ts: number }) {
  const [label, setLabel] = React.useState(() => formatRelative(ts, Date.now()));
  React.useEffect(() => {
    const tick = () => setLabel(formatRelative(ts, Date.now()));
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [ts]);
  if (!ts) return null;
  return <span>上次同步 {label}</span>;
}

function formatRelative(ts: number, now: number): string {
  const diff = now - ts;
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;
  if (diff < min) return '刚刚';
  if (diff < hr) return `${Math.round(diff / min)} 分钟前`;
  if (diff < day) return `${Math.round(diff / hr)} 小时前`;
  return `${Math.round(diff / day)} 天前`;
}
