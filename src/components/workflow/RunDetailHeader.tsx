'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatWorkflowError } from '@/lib/workflow/error-format';

export interface RunDetailHeaderRun {
  id: string;
  sessionId: string | null;
  status: 'running' | 'success' | 'error';
  error: string;
  startedAt: string;
  completedAt: string | null;
}

const STATUS_CFG = {
  success: { label: '执行成功', cls: 'bg-green-500/10 text-green-700 border-green-500/20' },
  error: { label: '执行失败', cls: 'bg-red-500/10 text-red-700 border-red-500/20' },
  running: { label: '执行中', cls: 'bg-blue-500/10 text-blue-700 border-blue-500/20 animate-pulse' },
} as const;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function durationLabel(start: string, end: string | null): string {
  if (!end) return '进行中...';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins < 60) return `${mins}m${secs}s`;
  return `${Math.floor(mins / 60)}h${mins % 60}m`;
}

export function RunDetailHeader({
  run,
  onRefresh,
}: {
  run: RunDetailHeaderRun;
  onRefresh: () => void;
}) {
  const cfg = STATUS_CFG[run.status] ?? STATUS_CFG.running;
  return (
    <div className="rounded-xl border border-border/60 bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <Badge className={`border text-xs px-2 py-0.5 ${cfg.cls}`}>{cfg.label}</Badge>
            <span className="text-xs text-muted-foreground font-mono">{run.id.slice(0, 8)}</span>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
            <div>
              <span className="text-muted-foreground">开始时间</span>
              <div className="font-medium">{formatDateTime(run.startedAt)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">完成时间</span>
              <div className="font-medium">{run.completedAt ? formatDateTime(run.completedAt) : '--'}</div>
            </div>
            <div>
              <span className="text-muted-foreground">总耗时</span>
              <div className="font-medium">{durationLabel(run.startedAt, run.completedAt)}</div>
            </div>
            <div>
              <span className="text-muted-foreground">会话 ID</span>
              <div className="font-mono text-xs">{run.sessionId ? `${run.sessionId.slice(0, 12)}...` : '--'}</div>
            </div>
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={onRefresh} className="shrink-0">
          刷新
        </Button>
      </div>

      {run.error && (
        <div className="mt-3 text-sm text-destructive bg-destructive/5 rounded-lg px-3 py-2 break-words">
          {formatWorkflowError(run.error)}
        </div>
      )}
    </div>
  );
}

export function runStatusBadgeCfg(status: RunDetailHeaderRun['status']) {
  return STATUS_CFG[status] ?? STATUS_CFG.running;
}
