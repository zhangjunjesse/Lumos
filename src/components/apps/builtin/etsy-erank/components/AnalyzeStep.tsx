'use client';

import * as React from 'react';

import { BULK_METRICS_REAL, EHUNT_ANALYSIS as MOCK_EHUNT, SCORED_NICHES as MOCK_SCORED } from '../mock-data';
import { EhuntDeepPanel } from './EhuntDeepPanel';
import { useChatDock } from './ChatDock';
import type { BulkMetric, EhuntKeywordData, ScoredNiche } from '../etsy-erank-types';

type SortKey = 'sales' | 'new_store_rate' | 'top5_concentration' | 'keyword';

const SORT_LABEL: Record<SortKey, string> = {
  sales: '顶 listing 销量 ↓',
  new_store_rate: '新店出单率 ↓',
  top5_concentration: '头部集中度 ↑',
  keyword: '字母序',
};

// 从 ⑤ scored niches + ④ bulk metrics 里集合 A 级 candidate
// 支持传入真 run 数据,否则降级到 mock(纯 demo 入口)
function collectAGradeRows(
  scored: ScoredNiche[],
  bulk: BulkMetric[],
): Array<{
  keyword: string;
  seed: string;
  productGuess: string;
  rationale: string;
  nextStep: string;
  metric: BulkMetric | undefined;
}> {
  const rows: Array<{
    keyword: string;
    seed: string;
    productGuess: string;
    rationale: string;
    nextStep: string;
    metric: BulkMetric | undefined;
  }> = [];

  const metricsByKw = new Map(bulk.map((m) => [m.keyword, m]));

  for (const niche of scored) {
    for (const cand of niche.candidates) {
      const metric = metricsByKw.get(cand.keyword);
      if (metric?.grade !== 'A') continue;
      rows.push({
        keyword: cand.keyword,
        seed: niche.seed,
        productGuess: cand.productGuess,
        rationale: cand.rationale,
        nextStep: cand.nextStep,
        metric,
      });
    }
  }
  return rows;
}

function newStoreRate(keyword: string, ehunt: Record<string, EhuntKeywordData>): number {
  const data = ehunt[keyword];
  if (!data) return 0;
  const n = data.analysis.newStores;
  if (n.within30 === 0) return -1;
  return n.within30WithSales / n.within30;
}

export interface AnalyzeStepProps {
  ehuntAnalysis?: Record<string, EhuntKeywordData>;
  scoredNiches?: ScoredNiche[];     // 真 run 的 ⑤ scored niches
  bulkMetrics?: BulkMetric[];       // 真 run 的 ④ bulk
  runId?: string;                   // 真 run 的 id,用于 ⑥ keyword AI 对话
}

export function AnalyzeStep({ ehuntAnalysis, scoredNiches, bulkMetrics, runId }: AnalyzeStepProps = {}): React.ReactElement {
  const EHUNT_ANALYSIS = ehuntAnalysis ?? MOCK_EHUNT;
  // 真数据优先,缺则降级到 mock(纯 demo 模式)
  const effectiveScored = scoredNiches ?? MOCK_SCORED;
  const effectiveBulk = bulkMetrics ?? BULK_METRICS_REAL;
  const [sortBy, setSortBy] = React.useState<SortKey>('sales');
  const [expandedKw, setExpandedKw] = React.useState<string | null>(null);

  const rows = React.useMemo(() => collectAGradeRows(effectiveScored, effectiveBulk), [effectiveScored, effectiveBulk]);

  const sorted = React.useMemo(() => {
    const arr = [...rows];
    if (sortBy === 'sales') {
      arr.sort((a, b) => {
        const ea = EHUNT_ANALYSIS[a.keyword]?.analysis.sales.max ?? 0;
        const eb = EHUNT_ANALYSIS[b.keyword]?.analysis.sales.max ?? 0;
        return eb - ea;
      });
    } else if (sortBy === 'new_store_rate') {
      arr.sort((a, b) => newStoreRate(b.keyword, EHUNT_ANALYSIS) - newStoreRate(a.keyword, EHUNT_ANALYSIS));
    } else if (sortBy === 'top5_concentration') {
      arr.sort((a, b) => {
        const ca = EHUNT_ANALYSIS[a.keyword]?.analysis.top5SalesPct ?? 1;
        const cb = EHUNT_ANALYSIS[b.keyword]?.analysis.top5SalesPct ?? 1;
        return ca - cb;
      });
    } else {
      arr.sort((a, b) => a.keyword.localeCompare(b.keyword));
    }
    return arr;
  }, [sortBy, rows, EHUNT_ANALYSIS]);

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs">
        <span className="font-medium">
          {rows.length} 个 A 级关键词 · Etsy 头部 24 listing × EHunt 真实销量
        </span>
        <div className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          排序:
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setSortBy(k)}
              className={`rounded px-1.5 py-0.5 ring-1 ${
                sortBy === k
                  ? 'bg-background ring-border'
                  : 'text-muted-foreground ring-transparent hover:ring-border'
              }`}
            >
              {SORT_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        {sorted.map((row) => (
          <AGradeCard
            key={row.keyword}
            row={row}
            ehunt={EHUNT_ANALYSIS}
            runId={runId}
            open={expandedKw === row.keyword}
            onToggle={() => setExpandedKw(expandedKw === row.keyword ? null : row.keyword)}
          />
        ))}
      </div>
    </div>
  );
}

function AGradeCard({
  row,
  ehunt,
  runId,
  open,
  onToggle,
}: {
  row: ReturnType<typeof collectAGradeRows>[number];
  ehunt: Record<string, EhuntKeywordData>;
  runId?: string;
  open: boolean;
  onToggle: () => void;
}) {
  const data = ehunt[row.keyword];
  const chat = useChatDock();
  const attached = chat.isAttached(row.keyword);
  const [copied, setCopied] = React.useState(false);

  const copyKeyword = async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(row.keyword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = row.keyword;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1200); }
      finally { document.body.removeChild(ta); }
    }
  };
  const a = data?.analysis;

  // 头部 3 张缩略图
  const thumbs = (data?.listings ?? []).slice(0, 3);
  const topSales = a?.sales.max ?? null;
  const newStores = a ? `${a.newStores.within30WithSales}/${a.newStores.within30}` : '—';
  const top5 = a ? Math.round(a.top5SalesPct * 100) : null;

  return (
    <div className="overflow-hidden rounded-lg ring-1 ring-border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 bg-background px-3 py-2 text-left text-xs hover:bg-muted/30"
      >
        {/* 头部 3 张缩略图 */}
        <div className="flex shrink-0 -space-x-1">
          {thumbs.map((l) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={l.listing_id}
              src={l.img}
              alt=""
              className="h-9 w-9 shrink-0 rounded ring-1 ring-border object-cover"
            />
          ))}
          {thumbs.length === 0 && (
            <div className="h-9 w-9 rounded bg-muted text-[8px] text-muted-foreground flex items-center justify-center">
              无图
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono font-semibold text-foreground">{row.keyword}</span>
            <span
              role="button"
              tabIndex={0}
              onClick={copyKeyword}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); copyKeyword(e); } }}
              className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded px-1 py-0.5 text-[9px] text-muted-foreground ring-1 ring-border hover:bg-muted hover:text-foreground"
              title={`复制 keyword: ${row.keyword}`}
            >
              {copied ? '✓ 已复制' : '复制'}
            </span>
            <span className="text-[10px] text-muted-foreground">· {row.seed}</span>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 bg-emerald-500/10 text-emerald-700 ring-emerald-500/30">
              A
            </span>
          </div>
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {row.productGuess}
          </div>
        </div>

        {/* 紧凑统计 */}
        <div className="hidden shrink-0 items-center gap-1 text-[10px] tabular-nums md:flex">
          {topSales != null && (
            <span className="rounded bg-muted px-1.5 py-0.5" title="头部 listing 累计销量">
              销 {topSales}
            </span>
          )}
          <span className="rounded bg-muted px-1.5 py-0.5" title="新店 30 天 出单/总数">
            新店 {newStores}
          </span>
          {top5 != null && (
            <span className="rounded bg-muted px-1.5 py-0.5" title="头部 5 店占总销百分比">
              top5 {top5}%
            </span>
          )}
          {row.metric && (
            <>
              <span className="rounded bg-muted px-1.5 py-0.5">月搜 {row.metric.searches}</span>
              <span className="rounded bg-muted px-1.5 py-0.5">KD {row.metric.kd}</span>
            </>
          )}
        </div>

        {runId && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); if (attached) chat.detach(row.keyword); else chat.attach(row.keyword); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (attached) chat.detach(row.keyword); else chat.attach(row.keyword); } }}
            className={`shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[10px] ring-1 ${attached ? 'bg-emerald-500/15 text-emerald-700 ring-emerald-500/40' : 'bg-background text-muted-foreground ring-border hover:bg-muted'}`}
            title={attached ? '从对话上下文移除' : '把此 keyword 加到底部对话上下文'}
          >
            {attached ? '✓ 在对话中' : '+ 问 AI'}
          </span>
        )}
        <span className="shrink-0 text-[10px] text-muted-foreground">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-border bg-muted/20 px-3 py-3 text-xs">
          <div className="rounded border border-sky-500/30 bg-sky-50/40 px-2 py-1.5 text-[11px] leading-relaxed dark:bg-sky-950/20">
            <span className="text-[10px] font-semibold text-sky-700 dark:text-sky-400">⑤ AI 解读:</span>{' '}
            {row.rationale}
            {row.nextStep && (
              <span className="mt-0.5 block text-emerald-700">→ {row.nextStep}</span>
            )}
          </div>
          <EhuntDeepPanel data={data} runId={runId} keyword={row.keyword} />
        </div>
      )}
    </div>
  );
}
