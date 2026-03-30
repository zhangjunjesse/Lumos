'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

interface ScheduledWorkflow {
  id: string;
  name: string;
  intervalMinutes: number;
  workingDirectory: string;
  enabled: boolean;
  notifyOnComplete: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  lastRunStatus: 'success' | 'error' | '';
  lastError: string;
  workflowDsl?: Record<string, unknown>;
}

const INTERVALS = [
  { value: 5, label: '每 5 分钟' },
  { value: 15, label: '每 15 分钟' },
  { value: 30, label: '每 30 分钟' },
  { value: 60, label: '每小时' },
  { value: 360, label: '每 6 小时' },
  { value: 1440, label: '每天' },
  { value: 10080, label: '每周' },
];

function intervalLabel(minutes: number): string {
  return INTERVALS.find(i => i.value === minutes)?.label ?? `每 ${minutes} 分钟`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

interface ScheduleListProps {
  onNew: () => void;
  onEdit: (schedule: ScheduledWorkflow) => void;
}

export function ScheduleList({ onNew, onEdit }: ScheduleListProps) {
  const [schedules, setSchedules] = useState<ScheduledWorkflow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/workflow/schedules');
      const data = await res.json();
      setSchedules(data.schedules || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    await fetch(`/api/workflow/schedules/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    await load();
  }, [load]);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm('确认删除此定时任务？')) return;
    await fetch(`/api/workflow/schedules/${id}`, { method: 'DELETE' });
    await load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">定时任务</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            让工作流按计划自动执行
          </p>
        </div>
        <Button size="sm" onClick={onNew}>+ 新建定时任务</Button>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
      ) : schedules.length === 0 ? (
        <div className="text-sm text-muted-foreground py-12 text-center border rounded-lg border-dashed">
          <div className="mb-2 text-2xl">⏰</div>
          <div>还没有定时任务</div>
          <div className="text-xs mt-1">点击「新建定时任务」创建第一个</div>
        </div>
      ) : (
        <div className="space-y-3">
          {schedules.map(s => (
            <Card key={s.id} className={`border-border/60 shadow-sm ${!s.enabled ? 'opacity-60' : ''}`}>
              <CardHeader className="pb-2 pt-3 px-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-sm truncate">{s.name}</span>
                    <Badge variant="outline" className="text-xs shrink-0">{intervalLabel(s.intervalMinutes)}</Badge>
                    {s.lastRunStatus === 'error' && (
                      <Badge variant="destructive" className="text-xs shrink-0">上次失败</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      checked={s.enabled}
                      onCheckedChange={(v) => handleToggle(s.id, v)}
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-3 pt-0">
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>上次执行: {formatDateTime(s.lastRunAt)}</span>
                  <span>下次执行: {formatDateTime(s.nextRunAt)}</span>
                  <span>已执行 {s.runCount} 次</span>
                </div>
                {s.lastError && (
                  <div className="mt-1 text-xs text-destructive truncate">{s.lastError}</div>
                )}
                <div className="flex justify-end gap-2 mt-2">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onEdit(s)}>
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => handleDelete(s.id)}
                  >
                    删除
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

export { INTERVALS };
export type { ScheduledWorkflow };
