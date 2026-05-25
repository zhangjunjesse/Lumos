'use client';

import * as React from 'react';
import { AlertCircle, Calendar, CheckCircle2, Loader2, Play, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import { nativeActionUrl, useAppCollection } from './use-goofish-app-data';

type LastStatus = 'not_connected' | 'idle' | 'running' | 'success' | 'failed' | 'cancelled';
type ScheduleStatus = 'not_connected' | 'scheduled' | 'paused' | 'failed';

interface AppAutomationRow {
  id: string;
  title?: string;
  enabled?: boolean;
  schedule?: string;
  description?: string;
  native_action?: string;
  last_status?: LastStatus;
  last_run_summary?: string;
  last_run_id?: string;
  last_run_at?: string;
  schedule_id?: string;
  schedule_status?: ScheduleStatus;
  schedule_error?: string;
  next_run_at?: string | null;
  updated_at?: string;
}

const ACTION_DESC: Record<string, { name: string; hint: string }> = {
  'goofish:sync': {
    name: '同步闲鱼数据',
    hint: '通过 Lumos 受控集成同步账号、买家会话、商品上下文。',
  },
  'goofish:auto-reply-scan': {
    name: '白名单自动回复扫描',
    hint: '扫描新消息：命中已启用白名单且通过频控立即发送，否则降级为草稿。',
  },
  'goofish:check-reminders': {
    name: '提醒规则检查',
    hint: '按已启用的提醒规则检查（新消息 / 回复超时 / 关键词命中 / 草稿堆积）。',
  },
  'goofish:auto-fulfill-scan': {
    name: '自动发货扫描',
    hint: '扫描近 30 分钟付款类系统消息，命中商品库则自动发链接 + 提取码。开启前请先到设置阅读风险。',
  },
};

export function AutomationsTab(): React.ReactElement {
  const { rows, loading, error, refresh, update } = useAppCollection<AppAutomationRow>(
    'app_automations',
    { sortKey: 'native_action', sortDir: 'asc' },
  );
  const [runningId, setRunningId] = React.useState<string | null>(null);
  const [syncingId, setSyncingId] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const runAutomation = React.useCallback(
    async (row: AppAutomationRow) => {
      if (runningId) {
        setFeedback({ kind: 'error', text: '已有自动化在运行中，请稍后再试。' });
        return;
      }
      setRunningId(row.id);
      setFeedback(null);
      try {
        const res = await fetch(nativeActionUrl('app', 'run-automation'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rowId: row.id, confirmed: true }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
        if (!res.ok || !json.ok) throw new Error(json.message ?? '运行失败');
        setFeedback({ kind: 'ok', text: json.message ?? '已运行' });
        await refresh();
      } catch (err) {
        setFeedback({ kind: 'error', text: err instanceof Error ? err.message : '运行失败' });
      } finally {
        setRunningId(null);
      }
    },
    [runningId, refresh],
  );

  const syncSchedule = React.useCallback(
    async (row: AppAutomationRow) => {
      setSyncingId(row.id);
      setFeedback(null);
      try {
        const res = await fetch(nativeActionUrl('app', 'sync-automation-schedule'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rowId: row.id }),
        });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
        if (!res.ok || !json.ok) throw new Error(json.message ?? '同步定时任务失败');
        setFeedback({ kind: 'ok', text: json.message ?? '已同步定时任务' });
        await refresh();
      } catch (err) {
        setFeedback({
          kind: 'error',
          text: err instanceof Error ? err.message : '同步定时任务失败',
        });
      } finally {
        setSyncingId(null);
      }
    },
    [refresh],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">自动化</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            内置三条原生动作：同步、白名单自动回复、提醒检查。点击「同步定时」会注册为 Lumos 调度任务。
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={loading}>
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          刷新
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {feedback ? (
        <Alert variant={feedback.kind === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{feedback.text}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            加载自动化中…
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex min-h-32 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
            <span>尚未注册任何自动化</span>
            <span className="text-xs">应用骨架将自动写入三条 native_action；如果一直为空，请重启 Lumos 让初始化重新跑一次。</span>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <AutomationRow
              key={row.id}
              row={row}
              running={runningId === row.id}
              syncing={syncingId === row.id}
              triggerBlocked={runningId !== null && runningId !== row.id}
              onToggleEnabled={(enabled) => void update(row.id, { enabled })}
              onRun={() => void runAutomation(row)}
              onSyncSchedule={() => void syncSchedule(row)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AutomationRow({
  row,
  running,
  syncing,
  triggerBlocked,
  onToggleEnabled,
  onRun,
  onSyncSchedule,
}: {
  row: AppAutomationRow;
  running: boolean;
  syncing: boolean;
  triggerBlocked: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  onRun: () => void;
  onSyncSchedule: () => void;
}): React.ReactElement {
  const action = (row.native_action ?? '').toLowerCase();
  const meta = ACTION_DESC[action];
  const title = row.title || meta?.name || action || '未配置动作';
  const description = row.description || meta?.hint || '';

  return (
    <Card className={cn('transition-all', !row.enabled && 'opacity-70')}>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{title}</span>
              {action ? (
                <code className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                  {action}
                </code>
              ) : null}
              {row.schedule_status === 'scheduled' ? (
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                  已接入调度
                </span>
              ) : null}
              {row.schedule_status === 'paused' ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  已暂停
                </span>
              ) : null}
              {row.schedule_status === 'failed' ? (
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] text-destructive">
                  调度失败
                </span>
              ) : null}
            </div>
            {description ? (
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{description}</p>
            ) : null}
            {row.schedule ? (
              <p className="mt-1 text-[11px] text-muted-foreground">计划：{row.schedule}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Switch
              checked={row.enabled === true}
              onCheckedChange={(checked) => onToggleEnabled(Boolean(checked))}
            />
          </div>
        </div>

        {row.schedule_error ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{row.schedule_error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {row.last_status ? <LastStatusBadge status={row.last_status} /> : null}
            {row.last_run_summary ? (
              <span className="max-w-2xl truncate">{row.last_run_summary}</span>
            ) : null}
            {row.last_run_at ? <span>· {formatTime(row.last_run_at)}</span> : null}
          </div>
          <span className="shrink-0">
            {row.next_run_at ? `下次 ${formatTime(row.next_run_at)}` : ''}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onSyncSchedule}
            disabled={syncing || running}
            title="把这条自动化注册成 Lumos 定时任务，让调度器按计划运行"
          >
            {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <Calendar className="size-3.5" />}
            同步定时
          </Button>
          <Button
            size="sm"
            onClick={onRun}
            disabled={!row.enabled || running || triggerBlocked}
            title={!row.enabled ? '请先开启此自动化' : triggerBlocked ? '已有自动化在运行' : undefined}
          >
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            立即运行
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LastStatusBadge({ status }: { status: LastStatus }) {
  const { label, cls, icon: Icon } = lastStatusVariant(status);
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]', cls)}
    >
      {Icon ? <Icon className="size-3" /> : null}
      {label}
    </span>
  );
}

function lastStatusVariant(status: LastStatus): {
  label: string;
  cls: string;
  icon: React.ComponentType<{ className?: string }> | null;
} {
  switch (status) {
    case 'running':
      return {
        label: '运行中',
        cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
        icon: Loader2,
      };
    case 'success':
      return {
        label: '成功',
        cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
        icon: CheckCircle2,
      };
    case 'failed':
      return { label: '失败', cls: 'bg-destructive/10 text-destructive', icon: AlertCircle };
    case 'cancelled':
      return { label: '已取消', cls: 'bg-muted text-muted-foreground', icon: null };
    case 'not_connected':
      return { label: '未接入', cls: 'bg-muted text-muted-foreground', icon: null };
    default:
      return { label: '空闲', cls: 'bg-muted text-muted-foreground', icon: null };
  }
}

function formatTime(iso?: string | null): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
