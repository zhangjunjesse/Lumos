'use client';

import * as React from 'react';
import { AlertCircle, Calendar, Loader2, Play, RefreshCw } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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

export function AutomationsTab(): React.ReactElement {
  const { rows, loading, error, refresh, update } = useAppCollection<AutomationRow>(
    'app_automations',
    { sortKey: 'native_action', sortDir: 'asc' },
  );
  const [running, setRunning] = React.useState<string | null>(null);
  const [feedback, setFeedback] = React.useState<{
    kind: 'ok' | 'error';
    text: string;
  } | null>(null);

  async function runNow(row: AutomationRow): Promise<void> {
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

  async function syncSchedule(row: AutomationRow): Promise<void> {
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
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">自动化</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            管理定时任务、手动触发意图和最近运行状态。默认禁用，开启前请先在「设置」配置默认 LLM、配额与采集来源白名单。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="mr-1.5 size-4" />
          刷新
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {feedback && (
        <Alert variant={feedback.kind === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{feedback.text}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            尚未配置自动化。等待首次安装初始化注入默认条目。
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="space-y-3 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{row.title ?? row.native_action}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {row.last_status ?? 'idle'}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {row.schedule_status ?? 'not_connected'}
                      </Badge>
                    </div>
                    {row.description && (
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{row.description}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="size-3" />
                        {row.schedule ?? '未设置'}
                      </span>
                      {row.next_run_at && <span>· 下次：{row.next_run_at}</span>}
                    </div>
                    {row.last_run_summary && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        最近运行：{row.last_run_summary}
                      </div>
                    )}
                    {row.schedule_error && (
                      <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        调度失败：{row.schedule_error}
                      </div>
                    )}
                  </div>
                  <Switch
                    checked={Boolean(row.enabled)}
                    onCheckedChange={(v) => void update(row.id, { enabled: v })}
                  />
                </div>
                <div className="flex gap-2 border-t pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={running === row.id}
                    onClick={() => void runNow(row)}
                  >
                    {running === row.id ? (
                      <Loader2 className="mr-1.5 size-4 animate-spin" />
                    ) : (
                      <Play className="mr-1.5 size-4" />
                    )}
                    立即运行
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void syncSchedule(row)}>
                    同步定时任务
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
