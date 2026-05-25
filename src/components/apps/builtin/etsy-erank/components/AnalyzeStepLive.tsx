'use client';

import * as React from 'react';

import { AnalyzeStep } from './AnalyzeStep';
import { StepRunPanel } from './StepRunPanel';
import { EmptyStepState } from './EmptyStepState';
import type { BulkMetric, EhuntKeywordData, Grade, ScoredNiche } from '../etsy-erank-types';
import type { RadarStepRow } from '@/lib/etsy-erank/types';

interface ApiItem {
  keyword: string;
  analysis: EhuntKeywordData['analysis'];
  listings: EhuntKeywordData['listings'];
}

interface ApiVerifyRow {
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

interface ApiScoredNiche {
  seed: string;
  niche_summary: string;
  niche_risks: string[];
  candidates: ScoredNiche['candidates'];
  stats: ScoredNiche['stats'];
}

export function AnalyzeStepLive({ runId, isRealRun, step }: { runId: string; isRealRun: boolean; step: RadarStepRow | null }): React.ReactElement {
  const [items, setItems] = React.useState<ApiItem[] | null>(null);
  const [scored, setScored] = React.useState<ScoredNiche[] | null>(null);
  const [bulk, setBulk] = React.useState<BulkMetric[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refetch = React.useCallback(async () => {
    if (!isRealRun) return;
    try {
      // 并行拉 ⑥/⑤/④ 三个数据源
      const [analyzeRes, scoreRes, verifyRes] = await Promise.all([
        fetch(`/api/apps/builtin/etsy-erank/runs/${encodeURIComponent(runId)}/analyze`),
        fetch(`/api/apps/builtin/etsy-erank/runs/${encodeURIComponent(runId)}/score`),
        fetch(`/api/apps/builtin/etsy-erank/runs/${encodeURIComponent(runId)}/verify`),
      ]);
      if (analyzeRes.ok) {
        const j = (await analyzeRes.json()) as { items: ApiItem[] };
        setItems(j.items);
      }
      if (scoreRes.ok) {
        const j = (await scoreRes.json()) as { scoredNiches: ApiScoredNiche[] };
        setScored(j.scoredNiches.map((n) => ({
          seed: n.seed,
          niche_summary: n.niche_summary,
          niche_risks: n.niche_risks,
          candidates: n.candidates,
          stats: n.stats,
        })));
      }
      if (verifyRes.ok) {
        const j = (await verifyRes.json()) as { metrics: ApiVerifyRow[] };
        setBulk(j.metrics.map((r) => ({
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
        })));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [runId, isRealRun]);

  React.useEffect(() => { refetch(); }, [refetch]);
  React.useEffect(() => { if (step?.state === 'done' || step?.state === 'running') refetch(); }, [step?.state, refetch]);

  const ehuntMap = React.useMemo(() => {
    if (!items) return undefined;
    const m: Record<string, EhuntKeywordData> = {};
    for (const it of items) m[it.keyword] = { analysis: it.analysis, listings: it.listings };
    return m;
  }, [items]);
  const hasRealData = isRealRun && ehuntMap && Object.keys(ehuntMap).length > 0;
  // 即使 ⑥ 还没跑,只要 ④ 有数据,就把真 A 级 candidate 列出来(避免显示 mock 假数据)
  const hasBulk = isRealRun && (bulk?.length ?? 0) > 0;
  // ⑤ 没跑时,从 ④ bulk 的 A 级词伪装成空 niche(productGuess 等为空字符串提示)
  const effectiveScored = React.useMemo<ScoredNiche[] | undefined>(() => {
    if (!isRealRun) return undefined;
    if (scored && scored.length > 0) return scored;
    if (!bulk) return undefined;
    const groups = new Map<string, BulkMetric[]>();
    for (const r of bulk) {
      if (r.grade !== 'A') continue;
      if (!groups.has(r.seed)) groups.set(r.seed, []);
      groups.get(r.seed)!.push(r);
    }
    if (groups.size === 0) return undefined;
    return [...groups.entries()].map(([seed, items]) => ({
      seed,
      niche_summary: '',
      niche_risks: [],
      candidates: items.map((m) => ({
        keyword: m.keyword,
        productGuess: '⑤ AI 解读未跑',
        rationale: '',
        confidence: 'medium' as const,
        nextStep: '',
      })),
      stats: {
        a_count: items.length, b_count: 0, c_count: 0,
        top_a_searches: 0, top_a_keyword: '', risks_count: 0,
      },
    }));
  }, [isRealRun, scored, bulk]);

  return (
    <div className="space-y-3">
      {isRealRun && (
        <StepRunPanel
          runId={runId}
          stepId="analyze"
          step={step}
          runButtonLabel="跑 ⑥ EHunt 商业分析"
          rerunButtonLabel="续跑 ⑥"
          startConfirm="对所有未跑过的 A 级 keyword 抓 Etsy 头部 24 listing + EHunt 注入数据 + LLM 切入建议(已跑过的会自动跳过)。预计每 keyword ~30 秒。继续?"
          onStarted={refetch}
        />
      )}

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 ring-1 ring-red-500/30">
          拉商业分析数据失败:{error}
          <button type="button" onClick={refetch} className="ml-2 underline">重试</button>
        </div>
      )}

      {hasRealData ? (
        // ⑥ 真数据 + ④/⑤ 真数据 全部到位
        <AnalyzeStep ehuntAnalysis={ehuntMap} scoredNiches={effectiveScored} bulkMetrics={bulk ?? undefined} runId={runId} />
      ) : hasBulk ? (
        // ④ 已跑(且有 A 级)但 ⑥ 没跑 — 显示真 A 级列表,ehunt 为空各行显示"无图"
        <AnalyzeStep ehuntAnalysis={{}} scoredNiches={effectiveScored} bulkMetrics={bulk ?? undefined} />
      ) : isRealRun ? (
        <EmptyStepState step={step} pendingHint="先跑完 ④,再点上面&ldquo;跑 ⑥ EHunt 商业分析&rdquo;,对所有 A 级关键词抓 Etsy 头部 24 listing × EHunt 注入 + LLM 切入建议。" runningHint="正在串行抓 A 级关键词的 EHunt 数据 + 下载主图,完成后 LLM 给一句话切入建议。" />
      ) : (
        <AnalyzeStep ehuntAnalysis={undefined} />
      )}
    </div>
  );
}
