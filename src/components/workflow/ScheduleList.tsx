'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  lastRunStatus: 'success' | 'error' | 'cancelled' | '';
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
  if (status === 'cancelled') return <span className="w-2 h-2 rounded-full bg-muted-foreground/50 shrink-0" />;
  return <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />;
}

function ScheduleCard({
  schedule: s,
  selected,
  onSelectToggle,
  onEdit,
  onNavigate,
  onToggle,
  onDelete,
  onTrigger,
}: {
  schedule: ScheduledWorkflow;
  selected: boolean;
  onSelectToggle: (id: string, next: boolean) => void;
  onEdit: (s: ScheduledWorkflow) => void;
  onNavigate: (s: ScheduledWorkflow) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onTrigger: (s: ScheduledWorkflow) => void;
}) {
  return (
    <div
      className={`group relative rounded-lg border bg-card p-4 hover:shadow-md transition-all cursor-pointer ${
        selected ? 'border-primary/60 ring-1 ring-primary/30' : 'border-border/60 hover:border-border'
      } ${!s.enabled ? 'opacity-55' : ''}`}
      onClick={() => onNavigate(s)}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex items-center pt-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={(value) => onSelectToggle(s.id, value === true)}
            aria-label={`选择任务 ${s.name}`}
          />
        </div>
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
            {s.lastRunStatus === 'cancelled' && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 shrink-0">上次取消</Badge>
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/workflow/schedules');
      const data = await res.json();
      setSchedules(data.schedules || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, []);

  // Drop selections that no longer exist (e.g. deleted out of band) so the
  // toolbar count never drifts from reality.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const liveIds = new Set(schedules.map((s) => s.id));
      const next = new Set<string>();
      for (const id of prev) {
        if (liveIds.has(id)) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [schedules]);

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

  const toggleSelect = useCallback((id: string, next: boolean) => {
    setSelectedIds((prev) => {
      const out = new Set(prev);
      if (next) out.add(id);
      else out.delete(id);
      return out;
    });
  }, []);

  const allSelected = useMemo(
    () => schedules.length > 0 && schedules.every((s) => selectedIds.has(s.id)),
    [schedules, selectedIds],
  );

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === schedules.length && schedules.length > 0) return new Set();
      return new Set(schedules.map((s) => s.id));
    });
  }, [schedules]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0 || bulkDeleting) return;
    if (!confirm(`确认批量删除选中的 ${selectedIds.size} 个任务？正在执行的会一并停止。`)) return;
    setBulkDeleting(true);
    setTriggerMsg('');
    try {
      const ids = Array.from(selectedIds);
      const res = await fetch('/api/workflow/schedules/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json() as {
        error?: string;
        summary?: { deleted: number; failed: number; cancelledRuns: number };
      };
      if (!res.ok || data.error) {
        setTriggerMsg(`批量删除失败: ${data.error || res.statusText}`);
      } else if (data.summary) {
        const { deleted, failed, cancelledRuns } = data.summary;
        const parts = [`✅ 已删除 ${deleted} 个任务`];
        if (cancelledRuns > 0) parts.push(`同时停止 ${cancelledRuns} 个执行中的工作流`);
        if (failed > 0) parts.push(`${failed} 个删除失败`);
        setTriggerMsg(parts.join('，'));
      }
      clearSelection();
      await load();
    } catch (err) {
      setTriggerMsg(`批量删除失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setBulkDeleting(false);
    }
  }, [selectedIds, bulkDeleting, load, clearSelection]);

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

        {schedules.length > 0 && (
          <div className="sticky top-0 z-10 -mx-1 px-1 py-2 backdrop-blur bg-background/80 border-b border-border/40">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Checkbox
                checked={allSelected ? true : selectedIds.size > 0 ? 'indeterminate' : false}
                onCheckedChange={() => toggleSelectAll()}
                aria-label="全选"
              />
              <span className="text-muted-foreground">
                {selectedIds.size === 0
                  ? `共 ${schedules.length} 个任务`
                  : `已选 ${selectedIds.size} / ${schedules.length}`}
              </span>
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-8"
                    disabled={bulkDeleting}
                    onClick={() => void handleBulkDelete()}
                  >
                    {bulkDeleting ? '删除中…' : `🗑 删除 ${selectedIds.size} 个`}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    disabled={bulkDeleting}
                    onClick={clearSelection}
                  >
                    取消选择
                  </Button>
                </div>
              )}
            </div>
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
                selected={selectedIds.has(s.id)}
                onSelectToggle={toggleSelect}
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
