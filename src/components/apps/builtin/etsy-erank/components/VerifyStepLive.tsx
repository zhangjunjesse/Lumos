'use client';

import * as React from 'react';

import { MetricsTable } from './MetricsTable';
import { StepRunPanel } from './StepRunPanel';
import { EmptyStepState } from './EmptyStepState';
import type { BulkMetric, Grade } from '../etsy-erank-types';
import type { RadarStepRow } from '@/lib/etsy-erank/types';

interface ApiRow {
  seed: string;
  sources: string[];
  keyword: string;
  searches: string;
  clicks: string;
  ctr: string;
  competition: string;
  kd: string;
  google: string;
  grade: string;
}

function apiToBulk(rows: ApiRow[]): BulkMetric[] {
  return rows.map((r) => ({
    seed: r.seed,
    sources: r.sources,
    keyword: r.keyword,
    searches: r.searches,
    clicks: r.clicks,
    ctr: r.ctr,
    competition: r.competition,
    kd: r.kd,
    google: r.google,
    grade: r.grade as Grade,
  }));
}

interface VerifyData {
  metrics: ApiRow[];
  gradeCounts: { A: number; B: number; C: number; drop: number };
}

export function VerifyStepLive({ runId, isRealRun, step, defaultBatches }: { runId: string; isRealRun: boolean; step: RadarStepRow | null; defaultBatches?: number }): React.ReactElement {
  const [data, setData] = React.useState<VerifyData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [batches, setBatches] = React.useState<number>(defaultBatches ?? 30);
  // 当 defaultBatches 从父组件传进来(run 详情拉到后),同步一次
  React.useEffect(() => {
    if (defaultBatches != null) setBatches(defaultBatches);
  }, [defaultBatches]);

  const refetch = React.useCallback(async () => {
    if (!isRealRun) return;
    try {
      const res = await fetch(`/api/apps/builtin/etsy-erank/runs/${encodeURIComponent(runId)}/verify`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as VerifyData;
      setData(j);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId, isRealRun]);

  React.useEffect(() => { refetch(); }, [refetch]);
  React.useEffect(() => {
    if (step?.state === 'done' || step?.state === 'running') refetch();
  }, [step?.state, refetch]);

  const rows = React.useMemo(() => (data ? apiToBulk(data.metrics) : undefined), [data]);
  const hasRealData = isRealRun && rows && rows.length > 0;

  return (
    <div className="space-y-3">
      {isRealRun && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
            <label className="text-muted-foreground">本次跑批数:</label>
            <input
              type="number"
              min={1}
              max={100}
              value={batches}
              onChange={(e) => setBatches(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
              className="w-20 rounded border bg-background px-2 py-1 tabular-nums"
            />
            <span className="text-muted-foreground">批 × 20 词 = <span className="tabular-nums">{batches * 20}</span> 词</span>
            {defaultBatches != null && batches !== defaultBatches && (
              <button
                type="button"
                onClick={() => setBatches(defaultBatches)}
                className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground ring-1 ring-border hover:bg-muted"
              >
                重置为本轮默认({defaultBatches})
              </button>
            )}
            <span className="text-[10px] text-muted-foreground">eRank 每日 100 次配额,可分多次续跑</span>
          </div>
          <StepRunPanel
            runId={runId}
            stepId="verify"
            step={step}
            runButtonLabel={`跑 ④ ${batches} 批`}
            rerunButtonLabel={`续跑 ${batches} 批`}
            startConfirm={`即将跑 ${batches} 批 × 20 词 = ${batches * 20} 词,消耗 ${batches} 次 eRank 配额。已跑过的词会自动跳过(state 续跑)。继续?`}
            startBody={{ maxBatches: batches }}
            onStarted={refetch}
          />
        </>
      )}

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 ring-1 ring-red-500/30">
          拉 Bulk 数据失败:{error}
          <button type="button" onClick={refetch} className="ml-2 underline">重试</button>
        </div>
      )}

      {hasRealData ? (
        <MetricsTable rows={rows} isMock={false} />
      ) : isRealRun ? (
        <EmptyStepState step={step} pendingHint="点上面&ldquo;跑 ④ Bulk 验真&rdquo;启动 eRank Bulk Tool 批量验真(烧 eRank 配额)。" runningHint="正在 eRank Bulk Tool 跑批,每批 20 词,跑完一批立即入库。" />
      ) : (
        <MetricsTable rows={undefined} isMock={true} />
      )}
    </div>
  );
}
