'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { WorkflowRunDialog } from './WorkflowRunDialog';
import type { WorkflowParamDef } from '@/lib/workflow/types';

interface ScheduledWorkflow {
  id: string;
  name: string;
  runMode: 'scheduled' | 'once';
  intervalMinutes: number;
  scheduleTime?: string | null;
  scheduleDayOfWeek?: number | null;
  workingDirectory: string;
  enabled: boolean;
  notifyOnComplete: boolean;
  runParams?: Record<string, unknown>;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  lastRunStatus: 'success' | 'error' | '';
  lastError: string;
  workflowId?: string | null;
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

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function intervalLabel(s: ScheduledWorkflow): string {
  const base = INTERVALS.find(i => i.value === s.intervalMinutes)?.label ?? `每 ${s.intervalMinutes} 分钟`;
  if (s.intervalMinutes === 10080 && typeof s.scheduleDayOfWeek === 'number' && s.scheduleTime) {
    return `每${DAY_NAMES[s.scheduleDayOfWeek]} ${s.scheduleTime}`;
  }
  if (s.intervalMinutes === 1440 && s.scheduleTime) {
    return `每天 ${s.scheduleTime}`;
  }
  return base;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatNextRun(iso: string | null): string {
  if (!iso) return '--';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return '即将运行';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} 分钟后`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时后`;
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function StatusDot({ status, enabled }: { status: string; enabled: boolean }) {
  if (!enabled) return <span className="w-2 h-2 rounded-full bg-muted-foreground/30 shrink-0" />;
  if (status === 'error') return <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />;
  if (status === 'success') return <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />;
  return <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />;
}

function ScheduleCard({
  schedule: s,
  onEdit,
  onNavigate,
  onToggle,
  onDelete,
  onTrigger,
}: {
  schedule: ScheduledWorkflow;
  onEdit: (s: ScheduledWorkflow) => void;
  onNavigate: (s: ScheduledWorkflow) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onTrigger: (s: ScheduledWorkflow) => void;
}) {
  return (
    <div
      className={`group relative rounded-lg border border-border/60 bg-card p-4 hover:shadow-md hover:border-border transition-all cursor-pointer ${!s.enabled ? 'opacity-55' : ''}`}
      onClick={() => onNavigate(s)}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-lg shrink-0">
          {!s.enabled ? '⏸' : s.runMode === 'once' ? '▶' : '⏰'}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <StatusDot status={s.lastRunStatus} enabled={s.enabled} />
            <span className="font-medium text-sm truncate">{s.name}</span>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
              {s.runMode === 'once' ? '一次性' : intervalLabel(s)}
            </Badge>
            {s.lastRunStatus === 'error' && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 h-4 shrink-0">上次失败</Badge>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
            {s.runCount > 0 && <span>上次: {formatDateTime(s.lastRunAt)}</span>}
            {s.runMode === 'scheduled' && s.enabled && (
              <>
                {s.runCount > 0 && <span className="text-border">|</span>}
                <span className={formatNextRun(s.nextRunAt) === '即将运行' ? 'text-amber-600 dark:text-amber-400 font-medium' : ''}>
                  下次: {formatNextRun(s.nextRunAt)}
                </span>
              </>
            )}
            {s.runMode === 'once' && !s.enabled && s.runCount > 0 && (
              <span className="text-muted-foreground/60">已完成</span>
            )}
            {s.runCount > 0 && <><span className="text-border">|</span><span>共 {s.runCount} 次</span></>}
          </div>

          {s.lastError && (
            <div className="mt-1.5 text-xs text-destructive truncate bg-destructive/5 rounded px-2 py-0.5">
              {s.lastError}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
          <Switch checked={s.enabled} onCheckedChange={v => onToggle(s.id, v)} />
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground">···</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onTrigger(s)}>▶ 立即运行</DropdownMenuItem>
                <DropdownMenuItem onClick={() => onNavigate(s)}>查看详情</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onEdit(s)}>编辑</DropdownMenuItem>
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(s.id)}>删除</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ScheduleListProps {
  onNew: () => void;
  onEdit: (schedule: ScheduledWorkflow) => void;
}

export function ScheduleList({ onNew, onEdit }: ScheduleListProps) {
  const router = useRouter();
  const [schedules, setSchedules] = useState<ScheduledWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);
  const [triggerMsg, setTriggerMsg] = useState('');
  const [runDialog, setRunDialog] = useState<{ schedule: ScheduledWorkflow; params: WorkflowParamDef[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/workflow/schedules');
      const data = await res.json();
      setSchedules(data.schedules || []);
    } catch { /* ignore */ } finally { setLoading(false); }
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
    if (!confirm('确认删除此任务？')) return;
    await fetch(`/api/workflow/schedules/${id}`, { method: 'DELETE' });
    await load();
  }, [load]);

  const doTrigger = useCallback(async (id: string, params?: Record<string, unknown>) => {
    setTriggering(id);
    setTriggerMsg('');
    try {
      const res = await fetch(`/api/workflow/schedules/${id}/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ params }),
      });
      const data = await res.json() as { error?: string };
      setTriggerMsg(data.error ? `触发失败: ${data.error}` : '✅ 已触发，正在执行');
      await load();
    } catch { setTriggerMsg('触发失败，请重试'); } finally { setTriggering(null); }
  }, [load]);

  const handleTrigger = useCallback((s: ScheduledWorkflow) => {
    if (triggering) return;
    const dslParams = (s.workflowDsl as { params?: WorkflowParamDef[] } | undefined)?.params ?? [];
    if (dslParams.length > 0) {
      setRunDialog({ schedule: s, params: dslParams });
    } else {
      void doTrigger(s.id);
    }
  }, [triggering, doTrigger]);

  return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">任务</h2>
            <p className="text-sm text-muted-foreground">一次性执行或定时自动运行工作流</p>
          </div>
          <Button onClick={onNew}>+ 新建任务</Button>
        </div>

        {triggerMsg && (
          <div className={`text-sm px-3 py-2 rounded-lg border ${triggerMsg.startsWith('✅') ? 'bg-green-500/10 text-green-700 border-green-500/20' : 'bg-destructive/10 text-destructive border-destructive/20'}`}>
            {triggerMsg}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2].map(i => <div key={i} className="h-20 rounded-lg border border-border/40 bg-muted/30 animate-pulse" />)}
          </div>
        ) : schedules.length === 0 ? (
          <div className="text-center py-12 px-6 rounded-xl border border-dashed border-border/60 bg-muted/20">
            <div className="text-4xl mb-3">⏰</div>
            <div className="text-sm font-medium mb-1">还没有任务</div>
            <div className="text-xs text-muted-foreground mb-5">创建一次性或定时任务，让工作流自动运行</div>
            <Button onClick={onNew}>创建第一个任务</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {schedules.map(s => (
              <ScheduleCard
                key={s.id}
                schedule={s}
                onEdit={onEdit}
                onNavigate={(s) => router.push(`/workflow/schedules/${s.id}`)}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onTrigger={handleTrigger}
              />
            ))}
          </div>
        )}

        {runDialog && (
          <WorkflowRunDialog
            open
            scheduleName={runDialog.schedule.name}
            params={runDialog.params}
            defaultValues={runDialog.schedule.runParams ?? {}}
            onClose={() => setRunDialog(null)}
            onRun={params => void doTrigger(runDialog.schedule.id, params)}
          />
        )}
      </div>
  );
}

export { INTERVALS };
export type { ScheduledWorkflow };
