'use client';

import * as React from 'react';

import type { EntryMode } from '../etsy-erank-types';
import { useEtsyErank } from '../use-demo-state';
import { useRadarRuns } from '../use-radar-runs';
import { NewRunDialog } from '../components/NewRunDialog';
import { HealthBanner } from '../components/HealthBanner';
import type { RadarRunRow } from '@/lib/etsy-erank/types';

const STATUS: Record<RadarRunRow['status'], { label: string; cls: string }> = {
  running: { label: '进行中', cls: 'text-amber-600 bg-amber-500/10 ring-amber-500/30' },
  completed: { label: '已完成', cls: 'text-emerald-600 bg-emerald-500/10 ring-emerald-500/30' },
  failed: { label: '失败', cls: 'text-red-600 bg-red-500/10 ring-red-500/30' },
  archived: { label: '已归档', cls: 'text-muted-foreground bg-muted ring-border' },
};

const ENTRY_LABEL: Record<EntryMode, string> = {
  with_capability: '起点:有能力/方向',
  blank_slate: '起点:完全没想法(跳过①)',
};

function fmtTime(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface UnifiedRun {
  id: string;
  label: string;
  status: RadarRunRow['status'];
  entryMode: EntryMode;
  executor: string;
  startedAt: string;
  finishedAt?: string;
  seedCount: number;
  convergeCount: number;
  gradeA?: number;
  gradeB?: number;
  gradeC?: number;
  failureReason?: string;
}

export function RadarRunsTab(): React.ReactElement {
  const { dispatch } = useEtsyErank();
  const { data: realRuns, error, loading, refetch, deleteRun } = useRadarRuns();

  const unified: UnifiedRun[] = React.useMemo(() => {
    return (realRuns ?? []).map((r) => ({
      id: r.id,
      label: r.label,
      status: r.status,
      entryMode: r.entryMode,
      executor: r.executor,
      startedAt: fmtTime(r.startedAt),
      finishedAt: fmtTime(r.finishedAt),
      seedCount: r.seedCount,
      convergeCount: r.convergeCount,
      gradeA: r.gradeA,
      gradeB: r.gradeB,
      gradeC: r.gradeC,
      failureReason: r.failureReason,
    }));
  }, [realRuns]);
  const isEmpty = !loading && unified.length === 0 && !error;

  return (
    <div className="space-y-4">
      <HealthBanner />
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          每轮选品独立持久化,可随时回查/删除
        </p>
        <button
          type="button"
          onClick={() => dispatch({ t: 'toggle-new-run', v: true })}
          className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background"
        >
          + 新开一轮
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 ring-1 ring-red-500/30">
          拉轮次列表失败:{error}
          <button type="button" onClick={refetch} className="ml-2 underline">重试</button>
        </div>
      )}

      {isEmpty && (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center">
          <div className="text-sm font-medium text-foreground">还没跑过任何一轮</div>
          <p className="mt-1 text-xs text-muted-foreground">
            点右上&ldquo;新开一轮&rdquo;开始第一轮。一轮 = ② 抓种子 → ③ 扩词 → ④ Bulk 验真 → ⑤ AI 解读 → ⑥ EHunt 商业分析。
          </p>
          <button
            type="button"
            onClick={() => dispatch({ t: 'toggle-new-run', v: true })}
            className="mt-3 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background"
          >
            + 新开一轮
          </button>
        </div>
      )}

      <div className="space-y-3">
        {unified.map((run) => {
          const s = STATUS[run.status];
          return (
            <div
              key={run.id}
              className="rounded-2xl bg-card p-4 ring-1 ring-border/60"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold tabular-nums">{run.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${s.cls}`}>
                    {s.label}
                  </span>
                  <span className="rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
                    {ENTRY_LABEL[run.entryMode]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    执行器:{run.executor === 'paste' ? '粘贴' : 'AdsPower'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => dispatch({ t: 'open-run', v: run.id })}
                    className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background"
                  >
                    打开
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`删除 ${run.label}?不可恢复`)) return;
                      try {
                        await deleteRun(run.id);
                      } catch (e) {
                        alert(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
                      }
                    }}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground ring-1 ring-border hover:bg-muted"
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground tabular-nums">
                <span>开始 {run.startedAt}</span>
                {run.finishedAt && <span>结束 {run.finishedAt}</span>}
                <span>种子 {run.seedCount}</span>
                <span>收敛 {run.convergeCount}</span>
                {(run.gradeA || run.gradeB || run.gradeC) && (
                  <span>
                    机会 A{run.gradeA ?? 0} B{run.gradeB ?? 0} C{run.gradeC ?? 0}
                  </span>
                )}
              </div>
              {run.failureReason && (
                <p className="mt-2 rounded-lg bg-red-500/5 px-3 py-2 text-xs text-red-700 ring-1 ring-red-500/20">
                  失败原因:{run.failureReason}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <NewRunDialog onCreated={refetch} />
    </div>
  );
}
