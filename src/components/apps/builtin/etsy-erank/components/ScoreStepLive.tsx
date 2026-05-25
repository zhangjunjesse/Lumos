'use client';

import * as React from 'react';

import { ScoredNichesTable } from './ScoredNichesTable';
import { StepRunPanel } from './StepRunPanel';
import { EmptyStepState } from './EmptyStepState';
import type { ScoredNiche } from '../etsy-erank-types';
import type { RadarStepRow } from '@/lib/etsy-erank/types';

export function ScoreStepLive({ runId, isRealRun, step }: { runId: string; isRealRun: boolean; step: RadarStepRow | null }): React.ReactElement {
  const [niches, setNiches] = React.useState<ScoredNiche[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    if (!isRealRun) return;
    try {
      const res = await fetch(`/api/apps/builtin/etsy-erank/runs/${encodeURIComponent(runId)}/score`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { scoredNiches: ScoredNiche[] };
      setNiches(j.scoredNiches);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId, isRealRun]);

  React.useEffect(() => { refetch(); }, [refetch]);
  React.useEffect(() => { if (step?.state === 'done' || step?.state === 'running') refetch(); }, [step?.state, refetch]);

  const hasRealData = isRealRun && niches && niches.length > 0;

  return (
    <div className="space-y-3">
      {isRealRun && (
        <StepRunPanel
          runId={runId}
          stepId="score"
          step={step}
          runButtonLabel="跑 ⑤ AI 解读"
          startConfirm="对 ④ 跑出的所有 A/B/C 候选按 niche 分组,调 LLM 解读每个 niche 的机会/风险/产品建议。预计 5-15 分钟,~$1-2 API 成本。继续?"
          onStarted={refetch}
        />
      )}

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 ring-1 ring-red-500/30">
          拉解读数据失败:{error}
          <button type="button" onClick={refetch} className="ml-2 underline">重试</button>
        </div>
      )}

      {hasRealData ? (
        <ScoredNichesTable niches={niches} isMock={false} />
      ) : isRealRun ? (
        <EmptyStepState step={step} pendingHint="先跑完 ④ Bulk 验真,再点上面&ldquo;跑 ⑤ AI 解读&rdquo;启动 LLM 解读(烧 LLM tokens)。" runningHint="正在按 niche 分组调 LLM 解读,每个 niche 跑完入库。" />
      ) : (
        <ScoredNichesTable niches={undefined} isMock={true} />
      )}
    </div>
  );
}
