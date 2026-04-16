'use client';

import { useCallback, useEffect, useState } from 'react';

interface DebugRun {
  id: string;
  sessionId: string | null;
  status: 'running' | 'success' | 'error';
  error: string;
  startedAt: string;
  completedAt: string | null;
}

interface Props {
  workflowId: string;
  /** 引用变化即触发刷新(例如 debug snapshot 对象在每次运行结束后被替换) */
  refreshToken?: unknown;
}

const STATUS_CFG = {
  success: { label: '成功', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  error: { label: '失败', cls: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  running: { label: '运行中', cls: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
} as const;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function durationLabel(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

export function DebugRunHistory({ workflowId, refreshToken }: Props) {
  const [runs, setRuns] = useState<DebugRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/workflows/${workflowId}/debug/runs`, { cache: 'no-store' });
      const data = await res.json() as { runs?: DebugRun[] };
      setRuns(data.runs ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [workflowId]);

  useEffect(() => { void load(); }, [load, refreshToken]);

  const visible = expanded ? runs : runs.slice(0, 5);

  return (
    <div className="rounded-lg border border-border/40 bg-card">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30">
        <span className="text-[11px] font-medium text-foreground">调试历史</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{runs.length} 次</span>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            {loading ? '…' : '刷新'}
          </button>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="text-[10px] text-muted-foreground text-center py-2">暂无调试运行</div>
      ) : (
        <ul className="divide-y divide-border/30">
          {visible.map(run => {
            const cfg = STATUS_CFG[run.status] ?? STATUS_CFG.running;
            return (
              <li key={run.id} className="flex items-center gap-2 px-3 py-1.5 text-[10px]">
                <span className={`px-1.5 py-0 rounded ${cfg.cls} shrink-0`}>{cfg.label}</span>
                <span className="text-muted-foreground shrink-0">{formatTime(run.startedAt)}</span>
                <span className="text-muted-foreground shrink-0">{durationLabel(run.startedAt, run.completedAt)}</span>
                {run.error && (
                  <span className="text-red-500 truncate flex-1" title={run.error}>{run.error}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {runs.length > 5 && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="w-full text-[10px] text-muted-foreground hover:text-foreground py-1 border-t border-border/30"
        >
          {expanded ? '收起' : `查看全部 ${runs.length} 条`}
        </button>
      )}
    </div>
  );
}
