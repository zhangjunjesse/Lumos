'use client';

import * as React from 'react';
import { Loader2, Play, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

import { api } from './api';
import type { AutomationDto, WatchlistDto } from './types';

export function AutomationsTab({ active }: { active: boolean }): React.ReactElement {
  const [automations, setAutomations] = React.useState<AutomationDto[] | null>(null);
  const [watchlist, setWatchlist] = React.useState<WatchlistDto | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const [a, s] = await Promise.all([api.listAutomations(), api.settings()]);
      setAutomations(a.automations);
      setWatchlist(s.watchlist);
    } catch {
      setAutomations([]);
    }
  }, []);

  React.useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setMessage(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  if (automations === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        加载自动化…
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-4">
      {message ? (
        <Alert variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      {automations.map((auto) => (
        <Card key={auto.id}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">{auto.title ?? '自动化'}</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{auto.enabled ? '已启用' : '已停用'}</span>
              <Switch
                checked={auto.enabled === true}
                disabled={busy !== null}
                onCheckedChange={(checked) =>
                  void act('toggle', async () => {
                    await api.patchAutomation(auto.id, { enabled: checked });
                    await api.syncAutomationSchedule(auto.id).catch(() => undefined);
                  })
                }
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">{auto.description}</p>
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <Field label="触发规则" value={auto.schedule ?? '未设置'} />
              <Field label="调度状态" value={auto.schedule_status ?? 'not_connected'} />
              <Field label="最近状态" value={auto.last_status ?? 'idle'} />
              <Field label="下次运行" value={auto.next_run_at || '—'} />
            </div>
            {auto.last_run_summary ? (
              <p className="rounded-lg bg-muted/50 p-2 text-xs">{auto.last_run_summary}</p>
            ) : null}
            {auto.schedule_error ? (
              <p className="text-xs text-red-600 dark:text-red-400">调度失败：{auto.schedule_error}</p>
            ) : null}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null || auto.enabled !== true}
                onClick={() => void act('run', () => api.runAutomationNow(auto.id))}
              >
                {busy === 'run' ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                立即运行
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={() => void act('sync', () => api.syncAutomationSchedule(auto.id))}
              >
                {busy === 'sync' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                同步定时任务
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">监控清单</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {watchlist && watchlist.keywords.length > 0 ? (
            <p className="text-muted-foreground">
              {watchlist.keywords.length} 个关键词 × {watchlist.asins.length} 个 ASIN。
              重新设置：在查询结果页点「设为每日监控」。
            </p>
          ) : (
            <p className="text-muted-foreground">
              还没有监控清单。先在「查询」页跑一次，结果页点「设为每日监控」。
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">微信查询命令</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>绑定微信 IM 后，可用只读命令查看状态：</p>
          <p className="mt-1 font-mono text-xs">
            /app amazon-rank status · /app amazon-rank runs · /app amazon-rank acceptance · /app amazon-rank help
          </p>
          <p className="mt-2">发起新查询、改监控清单等操作不接受微信命令，请回到应用内确认。</p>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <p>
      <span className="text-muted-foreground">{label}：</span>
      <span>{value}</span>
    </p>
  );
}
