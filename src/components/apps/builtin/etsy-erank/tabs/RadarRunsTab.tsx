'use client';

import * as React from 'react';

import { RUNS } from '../mock-data';
import type { RadarRun } from '../etsy-erank-types';
import { useEtsyErank } from '../use-demo-state';

const STATUS: Record<RadarRun['status'], { label: string; cls: string }> = {
  running: { label: '进行中', cls: 'text-amber-600 bg-amber-500/10 ring-amber-500/30' },
  completed: { label: '已完成', cls: 'text-emerald-600 bg-emerald-500/10 ring-emerald-500/30' },
  failed: { label: '失败', cls: 'text-red-600 bg-red-500/10 ring-red-500/30' },
};

export function RadarRunsTab(): React.ReactElement {
  const { dispatch } = useEtsyErank();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          每月一轮(OPP-雷达-月份),滚动复用,劣汰旧轮。
        </p>
        <button
          type="button"
          className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background"
        >
          + 新开一轮
        </button>
      </div>

      <div className="space-y-3">
        {RUNS.map((run) => {
          const s = STATUS[run.status];
          return (
            <div
              key={run.id}
              className="rounded-2xl bg-card p-4 ring-1 ring-border/60"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums">{run.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${s.cls}`}>
                    {s.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    执行器:{run.executor === 'paste' ? '粘贴' : 'AdsPower'}
                  </span>
                </div>
                <div className="flex gap-2">
                  {run.status === 'failed' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          dispatch({ t: 'executor', v: 'paste' });
                          dispatch({ t: 'open-run', v: run.id });
                        }}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-border hover:bg-muted"
                      >
                        转粘贴重跑
                      </button>
                      <button
                        type="button"
                        onClick={() => dispatch({ t: 'open-run', v: run.id })}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium ring-1 ring-border hover:bg-muted"
                      >
                        查看
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => dispatch({ t: 'open-run', v: run.id })}
                      className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background"
                    >
                      打开
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground tabular-nums">
                <span>开始 {run.startedAt}</span>
                {run.finishedAt && <span>结束 {run.finishedAt}</span>}
                <span>种子 {run.seedCount}</span>
                <span>收敛 {run.convergeCount}</span>
                {run.gradeTally && (
                  <span>
                    机会 A{run.gradeTally.a} B{run.gradeTally.b} C{run.gradeTally.c} · 立项{' '}
                    {run.gradeTally.brief}
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
    </div>
  );
}
