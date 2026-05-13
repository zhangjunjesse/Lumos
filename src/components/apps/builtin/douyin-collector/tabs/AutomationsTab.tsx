'use client';

import * as React from 'react';
import { AlertCircle, Calendar, Loader2, Play, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

import { nativeActionUrl, useAppCollection } from '../use-app-data';

interface AutomationRow {
  id: string;
  title?: string;
  enabled?: boolean;
  schedule?: string;
  description?: string;
  native_action?: string;
  last_status?: string;
  last_run_summary?: string;
  schedule_status?: string;
  schedule_error?: string | null;
  next_run_at?: string | null;
}

const ACTION_DESC: Record<string, string> = {
  'douyin-collector:patrol-creators':
    '扫描 enabled 状态的博主订阅，按 cadence 拉增量视频。',
  'douyin-collector:patrol-keywords':
    '扫描启用的关键词订阅，按时间窗与去重天数拉视频。',
};

export function AutomationsTab(): React.ReactElement {
  const { rows, loading, error, refresh, update } = useAppCollection<AutomationRow>(
    'app_automations',
    { sortKey: 'native_action', sortDir: 'asc' },
  );
  const [running, setRunning] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(
    null,
  );

  async function runNow(row: AutomationRow) {
    setRunning(row.id);
    setFeedback(null);
    try {
      const res = await fetch(nativeActionUrl('app', 'run-automation'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rowId: row.id, confirmed: true }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      setFeedback({
        kind: json.ok ? 'ok' : 'error',
        text: json.message ?? (json.ok ? '已运行' : '运行失败'),
      });
      await refresh();
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRunning(null);
    }
  }

  async function syncSchedule(row: AutomationRow) {
    try {
      const res = await fetch(nativeActionUrl('app', 'sync-automation-schedule'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rowId: row.id }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      setFeedback({
        kind: json.ok ? 'ok' : 'error',
        text: json.message ?? (json.ok ? '已同步定时任务' : '同步失败'),
      });
      await refresh();
    } catch (err) {
      setFeedback({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">自动化</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            博主巡更与关键词跑批；当前底层抓取未实现，运行会以诚实失败原因结束。
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw className="size-3.5" />
          刷新
        </Button>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {feedback ? (
        <Alert variant={feedback.kind === 'ok' ? 'default' : 'destructive'}>
          <AlertDescription>{feedback.text}</AlertDescription>
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-card/40 px-6 py-10 text-center text-xs text-muted-foreground">
          尚无自动化条目。安装应用时由模板预置，下一次启动 Lumos 会自动 seed。
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <article
              key={row.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{row.title ?? row.native_action}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="size-3" />
                      {row.schedule ?? '未设置'}
                    </span>
                    {row.next_run_at && row.enabled ? (
                      <span className="ml-2 text-foreground/80">
                        · 下次 {formatRelativeTime(row.next_run_at)}
                      </span>
                    ) : null}
                    {row.schedule_status === 'failed' && row.schedule_error ? (
                      <span className="ml-2 text-rose-500">· {row.schedule_error}</span>
                    ) : null}
                    {row.native_action ? (
                      <span className="ml-2">· {ACTION_DESC[row.native_action] ?? row.native_action}</span>
                    ) : null}
                  </p>
                </div>
                <Switch
                  checked={!!row.enabled}
                  onCheckedChange={(v) => void update(row.id, { enabled: v })}
                />
              </div>

              {row.last_run_summary ? (
                <p
                  className={
                    row.last_status === 'failed'
                      ? 'text-xs text-rose-500'
                      : 'text-xs text-muted-foreground'
                  }
                >
                  {row.last_status === 'failed' ? <AlertCircle className="mr-1 inline size-3" /> : null}
                  {row.last_run_summary}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={running === row.id || !row.enabled}
                  onClick={() => void runNow(row)}
                >
                  {running === row.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  立即运行
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void syncSchedule(row)}
                >
                  同步定时任务
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Render an ISO timestamp as a Chinese-friendly relative time:
 *   "5 分钟内" / "2 小时后" / "明天 08:30" / "3 天后"
 *
 * Past times (overdue cron) format as "已过期 N 分钟" so the user
 * notices a stuck schedule rather than seeing "5 分钟前" as if it
 * fired correctly.
 */
function formatRelativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const diffMs = ts - Date.now();
  const absMin = Math.abs(diffMs) / 60_000;

  if (diffMs < 0) {
    if (absMin < 60) return `已过期 ${Math.round(absMin)} 分钟`;
    return `已过期 ${Math.round(absMin / 60)} 小时`;
  }
  if (absMin < 1) return '即将运行';
  if (absMin < 60) return `${Math.round(absMin)} 分钟后`;
  if (absMin < 24 * 60) return `${Math.round(absMin / 60)} 小时后`;
  const date = new Date(ts);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const datePart = sameYear
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : date.toISOString().slice(0, 10);
  const timePart = `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
  return `${datePart} ${timePart}`;
}
