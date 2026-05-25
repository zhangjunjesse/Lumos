'use client';

import * as React from 'react';

import { ExpandedKeywordsTable } from './ExpandedKeywordsTable';
import { StepRunPanel } from './StepRunPanel';
import { EmptyStepState } from './EmptyStepState';
import type { SeedExpansion, ExpansionSource } from '../etsy-erank-types';
import type { RadarStepRow } from '@/lib/etsy-erank/types';

interface ApiExpansion {
  seed: string;
  keywords: Array<{ keyword: string; sources: string[] }>;
}

function apiToSeedExpansion(items: ApiExpansion[]): SeedExpansion[] {
  return items.map((e) => ({
    seed: e.seed,
    keywords: e.keywords.map((k) => ({
      keyword: k.keyword,
      sources: k.sources
        .map((s) => {
          if (s === 'B_autocomplete') return 'B' as ExpansionSource;
          if (s === 'C_listing_ngram') return 'C' as ExpansionSource;
          if (s === 'A' || s === 'B' || s === 'C') return s as ExpansionSource;
          return 'B' as ExpansionSource;
        })
        .filter((v, i, arr) => arr.indexOf(v) === i),
    })),
  }));
}

export function ExpandStep({ runId, isRealRun, step }: { runId: string; isRealRun: boolean; step: RadarStepRow | null }): React.ReactElement {
  const [items, setItems] = React.useState<ApiExpansion[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    if (!isRealRun) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/apps/builtin/etsy-erank/runs/${encodeURIComponent(runId)}/expand`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { expansions: ApiExpansion[] };
      setItems(j.expansions);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [runId, isRealRun]);

  React.useEffect(() => { refetch(); }, [refetch]);
  React.useEffect(() => { if (step?.state === 'done') refetch(); }, [step?.state, refetch]);

  const expansions = React.useMemo(() => (items ? apiToSeedExpansion(items) : undefined), [items]);
  const hasRealData = isRealRun && expansions && expansions.length > 0;

  return (
    <div className="space-y-3">
      {isRealRun && (
        <StepRunPanel
          runId={runId}
          stepId="converge"
          step={step}
          runButtonLabel="跑 ③ 扩词"
          startConfirm="先 preFilter 收敛 ② 种子,再用 Etsy autocomplete (B 路) + AdsPower 抓 listing ngram (C 路) 扩词,顺手下载主图。预计 5-15 分钟。继续?"
          startPath={`/api/apps/builtin/etsy-erank/runs/${encodeURIComponent(runId)}/expand`}
          onStarted={refetch}
        />
      )}

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 ring-1 ring-red-500/30">
          拉扩词数据失败:{error}
          <button type="button" onClick={refetch} className="ml-2 underline">重试</button>
        </div>
      )}

      {hasRealData ? (
        <ExpandedKeywordsTable expansions={expansions} isMock={false} />
      ) : isRealRun ? (
        <EmptyStepState step={step} pendingHint="点上面&ldquo;跑 ③ 扩词&rdquo;启动 preFilter + B 路 autocomplete + C 路 listing ngram(免费,不烧 eRank 配额)。" runningHint="正在用 Etsy autocomplete + AdsPower 抓 listing ngram,并下载主图。" />
      ) : (
        <ExpandedKeywordsTable expansions={undefined} isMock={true} />
      )}
      {loading && hasRealData && <div className="text-xs text-muted-foreground">刷新中…</div>}
    </div>
  );
}
