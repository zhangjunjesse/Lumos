'use client';

import * as React from 'react';
import { Plus, Bell, FileText, Newspaper, BarChart3 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { NewTaskDialog, type RadarKind } from '../NewTaskDialog';
import type { RadarTaskRow } from '../types';

const KIND_META: Record<RadarKind, { label: string; icon: React.ElementType; description: string }> = {
  monitor: { label: '监控雷达', icon: Bell, description: '按关键词或账号扫推，命中规则入告警。命中可直接推 IM。' },
  topic: { label: '选题挖掘', icon: FileText, description: '按话题搜 + thread 抽取，AI 提炼成 Markdown 选题报告。' },
  digest: { label: '关注摘要', icon: Newspaper, description: '按 @ 列表拉最新推，AI 出日报或周报简报。' },
  stats: { label: '数据拆解', icon: BarChart3, description: '按账号或话题算互动率、发推节奏，AI 给出数据点评。' },
};

const STATUS_LABEL: Record<string, string> = {
  success: '成功', failed: '失败', running: '运行中', cancelled: '已取消',
  idle: '空闲', not_connected: '未连接', queued: '排队',
};

const CADENCE_LABEL: Record<string, string> = {
  manual: '手动', hourly: '每小时', every_6_hours: '每 6 小时', daily: '每天', weekly: '每周',
};

interface KindTabProps {
  kind: RadarKind;
  tasks: RadarTaskRow[];
  onOpenTask: (taskId: string) => void;
  onCreated: () => void;
}

export function KindTab({ kind, tasks, onOpenTask, onCreated }: KindTabProps): React.ReactElement {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const list = tasks.filter((t) => t.kind === kind);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
            <Icon className="size-5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight">{meta.label}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
          </div>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="size-4 mr-1" /> 新建任务
        </Button>
      </div>

      {list.length === 0 ? (
        <EmptyState kind={kind} onCreate={() => setDialogOpen(true)} />
      ) : (
        <div className="space-y-2">
          {list.map((task) => <TaskListRow key={task.id} task={task} onClick={() => onOpenTask(task.id)} />)}
        </div>
      )}

      <NewTaskDialog open={dialogOpen} kind={kind} onClose={() => setDialogOpen(false)} onCreated={onCreated} />
    </div>
  );
}

function TaskListRow({ task, onClick }: { task: RadarTaskRow; onClick: () => void }): React.ReactElement {
  const status = task.last_status ?? 'idle';
  const statusLabel = STATUS_LABEL[status] ?? status;
  const statusColor =
    status === 'success' ? 'text-emerald-600 dark:text-emerald-400'
    : status === 'failed' ? 'text-red-600 dark:text-red-400'
    : status === 'running' ? 'text-blue-600 dark:text-blue-400'
    : 'text-muted-foreground';
  const lastRun = task.last_run_started_at
    ? new Date(task.last_run_started_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '尚未运行';
  const nextRun = task.next_run_at && task.enabled !== false && task.cadence !== 'manual'
    ? new Date(task.next_run_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-lg border bg-card p-4 transition-colors hover:bg-muted/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{task.name || '未命名'}</span>
            {task.enabled === false && <Badge variant="outline" className="text-[10px] px-1.5 py-0">已禁用</Badge>}
            {task.im_enabled && <Badge variant="outline" className="text-[10px] px-1.5 py-0">推 IM</Badge>}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span>{CADENCE_LABEL[task.cadence ?? 'manual'] ?? task.cadence}</span>
            <span>·</span>
            <span className={statusColor}>{statusLabel}</span>
            <span>· 上次 {lastRun}</span>
            {nextRun && <span>· 下次 {nextRun}</span>}
          </div>
          {task.last_summary && (
            <div className="mt-1.5 text-xs text-muted-foreground line-clamp-1">{task.last_summary}</div>
          )}
        </div>
      </div>
    </button>
  );
}

function EmptyState({ kind, onCreate }: { kind: RadarKind; onCreate: () => void }): React.ReactElement {
  const hint = (
    kind === 'monitor' ? '比如：跟踪「Claude」「MCP」相关推文，命中互动数 ≥ 100 的入告警'
    : kind === 'topic' ? '比如：每天给「AI 应用层」做一份选题报告，AI 抓证据后提炼出可执行的方向'
    : kind === 'digest' ? '比如：关注 OpenAI / AnthropicAI / sama 等账号，每天 8 点出一份日报'
    : '比如：拆解一个账号最近 14 天的互动率、发推节奏和热门 thread'
  );
  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <p className="text-sm text-muted-foreground">还没有任务。</p>
      <p className="mt-1 text-xs text-muted-foreground/80 max-w-md mx-auto">{hint}</p>
      <Button onClick={onCreate} className="mt-4">
        <Plus className="size-4 mr-1" /> 新建第一个任务
      </Button>
    </div>
  );
}
