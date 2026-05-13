'use client';

import * as React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const APP_ID = 'goofish-assistant';
const COLLECTION = 'app_notifications';
const FETCH_LIMIT = 10;

export type NotificationChannel = 'system' | 'wechat_im';
export type NotificationStatus = 'not_connected' | 'ready' | 'sent' | 'failed';

export interface NotificationRow {
  id: string;
  channel: NotificationChannel;
  target_label: string;
  title: string;
  text: string;
  status: NotificationStatus;
  last_error: string | null;
  updated_at: string;
}

export interface UseGoofishNotifications {
  rows: NotificationRow[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useGoofishNotifications(): UseGoofishNotifications {
  const [rows, setRows] = React.useState<NotificationRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const search = new URLSearchParams({ collection: COLLECTION, limit: String(FETCH_LIMIT) });
      const res = await fetch(`/api/apps/${encodeURIComponent(APP_ID)}/data?${search.toString()}`, {
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => ({}))) as { rows?: unknown; error?: string };
      if (!res.ok) throw new Error(json.error ?? '加载触发记录失败');
      const list = Array.isArray(json.rows) ? json.rows.filter(isNotificationRow) : [];
      list.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));
      setRows(list.slice(0, FETCH_LIMIT));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载触发记录失败');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return { rows, loading, error, refresh };
}

export function RecentNotifications({
  rows,
  loading,
  onRefresh,
}: {
  rows: NotificationRow[];
  loading: boolean;
  onRefresh: () => Promise<void> | void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3 border-t pt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">触发记录</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            最近 {FETCH_LIMIT} 条提醒规则写入的通知（来自 app_notifications）
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void onRefresh()} disabled={loading}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          刷新
        </Button>
      </div>
      {!loading && rows.length === 0 ? (
        <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
          还没有触发记录，规则首次命中后会出现在这里
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <NotificationCard key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}

function NotificationCard({ row }: { row: NotificationRow }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{row.title || '应用通知'}</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {row.channel === 'wechat_im' ? '微信' : '应用内'}
          </span>
          <span className={cn('rounded-full px-1.5 py-0.5 text-[10px]', statusClass(row.status))}>
            {statusLabel(row.status)}
          </span>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {formatTime(row.updated_at)}
        </span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
        {row.text || '（空）'}
      </p>
      {row.last_error ? (
        <p className="mt-1 text-[11px] text-destructive">失败原因：{row.last_error}</p>
      ) : null}
    </div>
  );
}

function statusLabel(status: NotificationStatus): string {
  if (status === 'sent') return '已发送';
  if (status === 'failed') return '失败';
  if (status === 'ready') return '已就绪';
  return '未连通';
}

function statusClass(status: NotificationStatus): string {
  if (status === 'sent') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed') return 'bg-destructive/10 text-destructive';
  if (status === 'ready') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return 'bg-muted text-muted-foreground';
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function isNotificationRow(value: unknown): value is NotificationRow {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<NotificationRow>;
  return (
    typeof r.id === 'string'
    && (r.channel === 'system' || r.channel === 'wechat_im')
    && typeof r.title === 'string'
    && typeof r.text === 'string'
    && (r.status === 'not_connected' || r.status === 'ready' || r.status === 'sent' || r.status === 'failed')
  );
}
