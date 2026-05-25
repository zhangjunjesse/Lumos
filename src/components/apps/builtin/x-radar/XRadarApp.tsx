'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { Radio, RefreshCw, ExternalLink } from 'lucide-react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';

import { NewTaskDialog, type RadarKind } from './NewTaskDialog';
import type { RadarTaskRow } from './types';
import { OverviewTab } from './tabs/OverviewTab';
import { KindTab } from './tabs/KindTab';
import { TaskDetailTab } from './tabs/TaskDetailTab';

interface XRadarStatus {
  install: { installed: boolean; version: string | null };
  x: { loggedIn: boolean; screenName: string };
  library: { alerts: number; reports: number; digests: number; stats: number };
}

type TabValue = 'overview' | RadarKind;
const VALID_TABS: ReadonlySet<TabValue> = new Set(['overview', 'monitor', 'topic', 'digest', 'stats']);

function isValidTab(v: string | null): v is TabValue {
  return v !== null && VALID_TABS.has(v as TabValue);
}

export function XRadarApp(): React.ReactElement {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const initialTab = searchParams?.get('tab');
  const initialTaskId = searchParams?.get('task');
  const [tab, setTabState] = React.useState<TabValue>(isValidTab(initialTab) ? initialTab : 'overview');
  const [activeTaskId, setActiveTaskIdState] = React.useState<string | null>(initialTaskId);
  const [status, setStatus] = React.useState<XRadarStatus | null>(null);
  const [tasks, setTasks] = React.useState<RadarTaskRow[]>([]);
  const [running, setRunning] = React.useState(false);
  const [runMessage, setRunMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [editingTask, setEditingTask] = React.useState<RadarTaskRow | null>(null);

  const updateUrl = React.useCallback((nextTab: TabValue, nextTaskId: string | null) => {
    const p = new URLSearchParams(searchParams?.toString() ?? '');
    if (nextTab === 'overview') p.delete('tab'); else p.set('tab', nextTab);
    if (nextTaskId) p.set('task', nextTaskId); else p.delete('task');
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const setTab = (v: TabValue) => { setTabState(v); setActiveTaskIdState(null); setRunMessage(null); updateUrl(v, null); };
  const openTask = (taskId: string) => { setActiveTaskIdState(taskId); setRunMessage(null); updateUrl(tab, taskId); };
  const backToList = () => { setActiveTaskIdState(null); setRunMessage(null); updateUrl(tab, null); };

  // D6 修：监听浏览器后退/前进，URL 变 → state 跟着变
  React.useEffect(() => {
    const urlTab = searchParams?.get('tab');
    const urlTaskId = searchParams?.get('task');
    setTabState(isValidTab(urlTab) ? urlTab : 'overview');
    setActiveTaskIdState(urlTaskId);
  }, [searchParams]);

  const refresh = React.useCallback(async () => {
    try {
      const [s, t] = await Promise.all([
        fetch('/api/apps/builtin/x-radar/status', { cache: 'no-store' }).then((r) => r.json() as Promise<XRadarStatus>),
        fetch('/api/apps/x-radar/data?collection=radar_tasks&limit=500', { cache: 'no-store' }).then((r) => r.json() as Promise<{ rows?: RadarTaskRow[] }>),
      ]);
      setStatus(s);
      setTasks(t.rows ?? []);
    } catch (err) { console.error('refresh failed', err); }
  }, []);
  React.useEffect(() => { void refresh(); }, [refresh]);

  const taskCounts = React.useMemo(() => {
    const empty = { total: 0, running: 0, failed: 0 };
    const r: Record<RadarKind, { total: number; running: number; failed: number }> = {
      monitor: { ...empty }, topic: { ...empty }, digest: { ...empty }, stats: { ...empty },
    };
    for (const task of tasks) {
      const k = task.kind;
      if (!k || !r[k]) continue;
      r[k].total += 1;
      if (task.last_status === 'running') r[k].running += 1;
      if (task.last_status === 'failed') r[k].failed += 1;
    }
    return r;
  }, [tasks]);

  const activeTask = activeTaskId ? tasks.find((t) => t.id === activeTaskId) ?? null : null;

  const toggleEnabled = async (task: RadarTaskRow) => {
    await fetch(`/api/apps/x-radar/data?collection=radar_tasks&id=${encodeURIComponent(task.id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !task.enabled }),
    });
    await refresh();
  };

  const toggleIm = async (task: RadarTaskRow) => {
    const next = !task.im_enabled;
    await fetch(`/api/apps/x-radar/data?collection=radar_tasks&id=${encodeURIComponent(task.id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        im_enabled: next,
        im_target_label: next ? (task.im_target_label || '默认微信用户') : '',
      }),
    });
    await refresh();
  };

  const deleteTask = async (task: RadarTaskRow) => {
    if (!confirm(`确认删除「${task.name}」？关联的告警 / 报告 / 简报不会一并删除。`)) return;
    await fetch(`/api/apps/x-radar/data?collection=radar_tasks&id=${encodeURIComponent(task.id)}`, { method: 'DELETE' });
    backToList();
    await refresh();
  };

  const runTask = async (task: RadarTaskRow) => {
    if (!status?.x.loggedIn) { setRunMessage({ ok: false, text: 'X 未登录，先到「服务 → X」登录。' }); return; }
    setRunning(true);
    setRunMessage(null);
    try {
      // 走单 task 路径，跳过 cadence/enabled 过滤（cadence 是给定时巡更用的）
      const res = await fetch('/api/apps/x-radar/native-actions/x-radar/run-task', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
      setRunMessage({ ok: !!data.ok, text: data.message ?? data.error ?? '已跑完' });
      await refresh();
    } catch (err) {
      setRunMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setRunning(false);
    }
  };

  if (!status) return <div className="p-8 text-sm text-muted-foreground">加载中…</div>;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="border-b bg-card px-9 py-6">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-white shadow-sm">
            <Radio className="size-6" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold tracking-tight">X 雷达</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              纯读 X 工作台 · v{status.install.version ?? '—'} ·{' '}
              {status.x.loggedIn ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  X 已登录{status.x.screenName ? ` @${status.x.screenName}` : ''}
                </span>
              ) : (
                <Link href="/extensions?tab=x" className="text-blue-600 hover:underline inline-flex items-center gap-0.5">
                  X 未登录，去登录<ExternalLink className="size-3" />
                </Link>
              )}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="size-4 mr-1" /> 刷新
          </Button>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)} className="min-h-0 flex-1">
        <div className="border-b bg-muted/20">
          <TabsList className="mx-auto h-auto gap-1 bg-transparent px-9 py-1.5">
            <TabsTrigger value="overview" className="data-[state=active]:bg-background">概览</TabsTrigger>
            <TabsTrigger value="monitor" className="data-[state=active]:bg-background">监控雷达</TabsTrigger>
            <TabsTrigger value="topic" className="data-[state=active]:bg-background">选题挖掘</TabsTrigger>
            <TabsTrigger value="digest" className="data-[state=active]:bg-background">关注摘要</TabsTrigger>
            <TabsTrigger value="stats" className="data-[state=active]:bg-background">数据拆解</TabsTrigger>
          </TabsList>
        </div>

        <div className="h-full overflow-y-auto">
          <TabsContent value="overview" className="m-0 px-9 py-6">
            <OverviewTab status={status} taskCounts={taskCounts} onOpenKind={setTab} />
          </TabsContent>
          {(['monitor', 'topic', 'digest', 'stats'] as RadarKind[]).map((k) => (
            <TabsContent key={k} value={k} className="m-0 px-9 py-6">
              {activeTask && activeTask.kind === k ? (
                <TaskDetailTab
                  task={activeTask}
                  onBack={backToList}
                  onRun={() => void runTask(activeTask)}
                  onToggle={() => void toggleEnabled(activeTask)}
                  onDelete={() => void deleteTask(activeTask)}
                  onToggleIm={() => void toggleIm(activeTask)}
                  onEdit={() => setEditingTask(activeTask)}
                  running={running}
                  runMessage={runMessage}
                />
              ) : (
                <KindTab kind={k} tasks={tasks} onOpenTask={openTask} onCreated={() => void refresh()} />
              )}
            </TabsContent>
          ))}
        </div>
      </Tabs>

      {editingTask && (
        <NewTaskDialog
          open={true}
          kind={editingTask.kind ?? null}
          editTask={editingTask}
          onClose={() => setEditingTask(null)}
          onCreated={() => { setEditingTask(null); void refresh(); }}
        />
      )}
    </div>
  );
}
