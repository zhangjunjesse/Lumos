'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { WorkflowDslGraph } from '@/components/workflow/WorkflowDslGraph';
import { ScheduleRunList } from '@/components/workflow/ScheduleRunList';
import { ScheduleEditor } from '@/components/workflow/ScheduleEditor';
import type { WorkflowDSL } from '@/lib/workflow/types';

interface Schedule {
  id: string;
  name: string;
  runMode: 'scheduled' | 'once';
  intervalMinutes: number;
  workingDirectory: string;
  enabled: boolean;
  notifyOnComplete: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  lastRunStatus: 'success' | 'error' | '';
  lastError: string;
  workflowDsl: WorkflowDSL;
}

const INTERVAL_LABELS: Record<number, string> = {
  5: '每5分钟', 15: '每15分钟', 30: '每30分钟', 60: '每小时',
  360: '每6小时', 1440: '每天', 10080: '每周',
};

function intervalLabel(m: number) { return INTERVAL_LABELS[m] ?? `每${m}分钟`; }

function formatDateTime(iso: string | null) {
  if (!iso) return '--';
  return new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatNextRun(iso: string | null) {
  if (!iso) return '--';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return '即将运行';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} 分钟后`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时后`;
  return formatDateTime(iso);
}

export default function ScheduleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const scheduleId = typeof params.id === 'string' ? params.id : '';

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [triggerMsg, setTriggerMsg] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [showGraph, setShowGraph] = useState(true);
  const [presetNames, setPresetNames] = useState<Record<string, string>>({});
  const [runListKey, setRunListKey] = useState(0);

  const loadSchedule = useCallback(async () => {
    if (!scheduleId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/workflow/schedules/${scheduleId}`);
      const data = await res.json() as { schedule?: Schedule };
      if (data.schedule) setSchedule(data.schedule);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [scheduleId]);

  useEffect(() => { void loadSchedule(); }, [loadSchedule]);

  useEffect(() => {
    fetch('/api/workflow/agent-presets')
      .then(r => r.json())
      .then((d: { presets?: Array<{ id: string; name: string }> }) => {
        const map: Record<string, string> = {};
        for (const p of d.presets ?? []) map[p.id] = p.name;
        setPresetNames(map);
      })
      .catch(() => {});
  }, []);

  const handleTrigger = useCallback(async () => {
    if (triggering || !scheduleId) return;
    setTriggering(true);
    setTriggerMsg('');
    try {
      const res = await fetch(`/api/workflow/schedules/${scheduleId}/trigger`, { method: 'POST' });
      const data = await res.json() as { error?: string };
      setTriggerMsg(data.error ? `触发失败: ${data.error}` : '已触发，正在执行...');
      void loadSchedule();
      setRunListKey(k => k + 1);
    } catch { setTriggerMsg('触发失败'); } finally { setTriggering(false); }
  }, [triggering, scheduleId, loadSchedule]);

  const handleExport = useCallback(async () => {
    if (!scheduleId) return;
    try {
      const res = await fetch(`/api/workflow/export/${scheduleId}?source=schedule`);
      const pkg = await res.json() as { error?: string; workflow?: { name?: string } };
      if (pkg.error) { setTriggerMsg(`导出失败: ${pkg.error}`); return; }
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (pkg.workflow?.name || 'workflow').replace(/[/\\:*?"<>|]/g, '_');
      a.download = `${safeName}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { setTriggerMsg('导出失败'); }
  }, [scheduleId]);

  const handleDelete = useCallback(async () => {
    if (!schedule || !confirm(`确认删除任务「${schedule.name}」？`)) return;
    await fetch(`/api/workflow/schedules/${scheduleId}`, { method: 'DELETE' });
    router.push('/workflow/schedules');
  }, [schedule, scheduleId, router]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8 space-y-4">
        {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-muted/40 animate-pulse" />)}
      </div>
    );
  }

  if (!schedule) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8 text-center text-muted-foreground">
        <p>任务不存在</p>
        <Button variant="outline" className="mt-4" onClick={() => router.push('/workflow/schedules')}>返回列表</Button>
      </div>
    );
  }

  const steps = schedule.workflowDsl?.steps ?? [];

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      {/* 导航 */}
      <button onClick={() => router.push('/workflow/schedules')} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
        ← 任务管理
      </button>

      {/* 头部信息 + 操作按钮 */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold">{schedule.name}</h1>
            <Badge variant="outline" className="text-xs">
              {schedule.runMode === 'once' ? '一次性' : intervalLabel(schedule.intervalMinutes)}
            </Badge>
            <Badge variant={schedule.enabled ? 'default' : 'secondary'} className="text-xs">
              {schedule.enabled ? '启用' : '暂停'}
            </Badge>
          </div>
          <div className="mt-1.5 flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <span>上次: {formatDateTime(schedule.lastRunAt)}</span>
            <span>下次: {formatNextRun(schedule.nextRunAt)}</span>
            <span>共 {schedule.runCount} 次</span>
          </div>
          {schedule.lastError && (
            <div className="mt-1.5 text-xs text-destructive bg-destructive/5 rounded px-2 py-1 max-w-lg truncate">{schedule.lastError}</div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => void handleExport()}>导出</Button>
          <Button variant="outline" size="sm" onClick={() => setEditorOpen(true)}>编辑</Button>
          <Button size="sm" onClick={() => void handleTrigger()} disabled={triggering}>
            {triggering ? '执行中...' : '立即运行'}
          </Button>
        </div>
      </div>

      {triggerMsg && (
        <div className={`text-sm px-3 py-2 rounded-lg border ${
          triggerMsg.startsWith('已触发') ? 'bg-green-500/10 text-green-700 border-green-500/20' : 'bg-destructive/10 text-destructive border-destructive/20'
        }`}>{triggerMsg}</div>
      )}

      {/* 工作流结构（可折叠） */}
      {steps.length > 0 && (
        <div className="rounded-xl border border-border/60 overflow-hidden bg-card">
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted/30 transition-colors"
            onClick={() => setShowGraph(v => !v)}
          >
            <span>工作流结构 ({steps.length} 个步骤)</span>
            <span className="text-xs">{showGraph ? '收起' : '展开'}</span>
          </button>
          {showGraph && <WorkflowDslGraph steps={steps} presetNames={presetNames} />}
        </div>
      )}

      {/* 执行历史（内嵌，核心内容） */}
      <ScheduleRunList key={runListKey} scheduleId={schedule.id} />

      {/* 危险操作 */}
      <div className="pt-2 border-t border-border/40">
        <button onClick={() => void handleDelete()} className="text-xs text-destructive/70 hover:text-destructive transition-colors">
          删除此任务
        </button>
      </div>

      <ScheduleEditor
        open={editorOpen}
        initial={schedule as unknown as Parameters<typeof ScheduleEditor>[0]['initial']}
        onClose={() => setEditorOpen(false)}
        onSave={() => { void loadSchedule(); setEditorOpen(false); }}
      />
    </div>
  );
}
