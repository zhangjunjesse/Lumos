'use client';

import * as React from 'react';

import { SeedTable } from './SeedTable';
import { StepRunPanel } from './StepRunPanel';
import { EmptyStepState } from './EmptyStepState';
import type { SeedTerm } from '../etsy-erank-types';
import type { RadarStepRow } from '@/lib/etsy-erank/types';

interface ApiSeedRow {
  sourceTool: string;
  timeframe: string;
  rank: string;
  keyword: string;
  change: string;
  avgSearches: string;
  avgCtr: string;
  competition: string;
  trendNote: string;
  category: string;
}

function apiToSeedTerm(rows: ApiSeedRow[]): SeedTerm[] {
  return rows.map((r) => ({
    sourceTool: (r.sourceTool === 'Trend Buzz' || r.sourceTool === 'Monthly Trends' || r.sourceTool === 'Category Report' || r.sourceTool === 'Top Sellers')
      ? r.sourceTool
      : 'Trend Buzz',
    keyword: r.keyword,
    category: r.category,
    rank: r.rank,
    change: r.change,
    avgSearches: r.avgSearches,
    avgCtr: r.avgCtr,
    competition: r.competition,
    trendNote: r.trendNote,
  }));
}

export function SeedStep({ runId, isRealRun, step }: { runId: string; isRealRun: boolean; step: RadarStepRow | null }): React.ReactElement {
  const [rows, setRows] = React.useState<ApiSeedRow[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    if (!isRealRun) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/apps/builtin/etsy-erank/runs/${encodeURIComponent(runId)}/seed`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { seeds: ApiSeedRow[] };
      setRows(j.seeds);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [runId, isRealRun]);

  React.useEffect(() => {
    refetch();
  }, [refetch]);

  // step 状态变 done 时自动重拉数据
  React.useEffect(() => {
    if (step?.state === 'done') refetch();
  }, [step?.state, refetch]);

  const seeds = React.useMemo(() => (rows ? apiToSeedTerm(rows) : undefined), [rows]);
  const hasRealData = isRealRun && seeds && seeds.length > 0;

  return (
    <div className="space-y-3">
      {isRealRun && (
        <>
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            ② 参数(时间窗口 / 每源行数)在&ldquo;新开一轮&rdquo;时已设置;若要改重新跑,可点&ldquo;重跑&rdquo;时调用 API 时显式传参,或新开一轮调整。
          </div>
          <StepRunPanel
            runId={runId}
            stepId="seed"
            step={step}
            runButtonLabel="跑 ② 抓种子"
            startConfirm="启动 AdsPower 抓 eRank Trend Buzz + Monthly Trends(按本轮配置的 timeframe / limit)。预计 30-60 秒。继续?"
            onStarted={refetch}
          />
        </>
      )}

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 ring-1 ring-red-500/30">
          拉种子数据失败:{error}
          <button type="button" onClick={refetch} className="ml-2 underline">重试</button>
        </div>
      )}

      {hasRealData ? (
        <SeedTable seeds={seeds} isMock={false} />
      ) : isRealRun ? (
        <EmptyStepState step={step} pendingHint="点上面&ldquo;跑 ② 抓种子&rdquo;启动 eRank 抓取(默认按本轮配置的 timeframe / limit)。" runningHint="正在 AdsPower 接管 eRank 抓种子,完成后自动刷新。" />
      ) : (
        <SeedTable seeds={undefined} isMock={true} />
      )}
      {loading && hasRealData && <div className="text-xs text-muted-foreground">刷新中…</div>}
    </div>
  );
}
