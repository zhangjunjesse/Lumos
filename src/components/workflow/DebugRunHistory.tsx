'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatWorkflowError } from '@/lib/workflow/error-format';
import { DebugRunFailurePanel } from './DebugRunFailurePanel';

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
  const [open, setOpen] = useState(false);
  const [listExpanded, setListExpanded] = useState(false);
  const [openErrRunId, setOpenErrRunId] = useState<string | null>(null);

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

  const cleaned = useMemo(
    () => runs.map(r => ({ ...r, error: r.error ? formatWorkflowError(r.error) : '' })),
    [runs],
  );

  const lastRun = cleaned[0] ?? null;
  const lastCfg = lastRun ? STATUS_CFG[lastRun.status] ?? STATUS_CFG.running : null;

  // collapsed: one-line summary
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>调试历史</span>
        <span className="opacity-60">{runs.length} 次</span>
        {lastRun && lastCfg && (
          <>
            <span className={`px-1 py-0 rounded ${lastCfg.cls}`}>{lastCfg.label}</span>
            <span className="opacity-50">{formatTime(lastRun.startedAt)}</span>
          </>
        )}
        <span className="text-[9px] opacity-40">▸</span>
      </button>
    );
  }

  const visible = listExpanded ? cleaned : cleaned.slice(0, 5);

  return (
    <div className="rounded-lg border border-border/40 bg-card">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[11px] font-medium text-foreground hover:text-muted-foreground flex items-center gap-1"
        >
          <span className="text-[9px]">▾</span> 调试历史
        </button>
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

      {cleaned.length === 0 ? (
        <div className="text-[10px] text-muted-foreground text-center py-2">暂无调试运行</div>
      ) : (
        <ul className="divide-y divide-border/30">
          {visible.map(run => {
            const cfg = STATUS_CFG[run.status] ?? STATUS_CFG.running;
            const hasError = !!run.error;
            const errOpen = openErrRunId === run.id;
            return (
              <li key={run.id}>
                <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] hover:bg-accent/40 transition-colors">
                  <span className={`px-1.5 py-0 rounded ${cfg.cls} shrink-0`}>{cfg.label}</span>
                  <span className="text-muted-foreground shrink-0">{formatTime(run.startedAt)}</span>
                  <span className="text-muted-foreground shrink-0">{durationLabel(run.startedAt, run.completedAt)}</span>
                  {hasError ? (
                    <button
                      type="button"
                      onClick={() => setOpenErrRunId(errOpen ? null : run.id)}
                      className="flex-1 min-w-0 flex items-center gap-1 text-left text-red-500 hover:text-red-600"
                      title={errOpen ? '收起' : '点击查看完整错误'}
                    >
                      <span className="truncate">{run.error}</span>
                      <span className="text-[9px] opacity-60 shrink-0">{errOpen ? '▾' : '▸'}</span>
                    </button>
                  ) : (
                    <span className="flex-1" />
                  )}
                  <Link
                    href={`/workflow/schedules/${workflowId}/runs/${run.id}`}
                    target="_blank"
                    className="text-primary opacity-60 hover:opacity-100 shrink-0"
                    title="查看完整执行记录"
                  >→</Link>
                </div>
                {hasError && errOpen && (
                  <DebugRunFailurePanel
                    workflowId={workflowId}
                    runId={run.id}
                    fallbackError={run.error}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {runs.length > 5 && (
        <button
          type="button"
          onClick={() => setListExpanded(v => !v)}
          className="w-full text-[10px] text-muted-foreground hover:text-foreground py-1 border-t border-border/30"
        >
          {listExpanded ? '收起' : `查看全部 ${runs.length} 条`}
        </button>
      )}
    </div>
  );
}
