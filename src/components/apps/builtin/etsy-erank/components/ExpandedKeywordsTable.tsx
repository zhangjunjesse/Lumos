'use client';

import * as React from 'react';

import { SEED_EXPANSIONS as MOCK_SEED_EXPANSIONS } from '../mock-data';
import type { ExpansionSource, SeedExpansion } from '../etsy-erank-types';

const SOURCE_META: Record<
  ExpansionSource,
  { label: string; cls: string; tooltip: string }
> = {
  A: {
    label: 'A',
    cls: 'bg-amber-500/10 text-amber-700 ring-amber-500/30',
    tooltip: 'eRank Keyword Tool Related Searches(暂未启用)',
  },
  B: {
    label: 'B',
    cls: 'bg-sky-500/10 text-sky-700 ring-sky-500/30',
    tooltip: 'Etsy autocomplete:买家在搜索框真实输入的词(免费实时)',
  },
  C: {
    label: 'C',
    cls: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30',
    tooltip: 'Etsy listing 标题 ngram:头部 listing 标题里的高频 SEO 词组',
  },
};

function SourceBadge({ s }: { s: ExpansionSource }) {
  const m = SOURCE_META[s];
  return (
    <span
      title={m.tooltip}
      className={`inline-flex h-4 min-w-[14px] cursor-help items-center justify-center rounded px-1 text-[9px] font-semibold ring-1 ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

export interface ExpandedKeywordsTableProps {
  expansions?: SeedExpansion[];
  isMock?: boolean;
}

export function ExpandedKeywordsTable({ expansions, isMock }: ExpandedKeywordsTableProps = {}): React.ReactElement {
  const SEED_EXPANSIONS = expansions ?? MOCK_SEED_EXPANSIONS;
  const effectiveIsMock = isMock ?? !expansions;
  const [open, setOpen] = React.useState<Set<string>>(() => {
    return new Set(SEED_EXPANSIONS.slice(0, 3).map((e) => e.seed));
  });
  const [filterSource, setFilterSource] = React.useState<ExpansionSource | 'all'>('all');

  const toggle = (seed: string) => {
    const next = new Set(open);
    next.has(seed) ? next.delete(seed) : next.add(seed);
    setOpen(next);
  };

  // 统计
  const totalKeywords = SEED_EXPANSIONS.reduce((n, e) => n + e.keywords.length, 0);
  const sourceCounts = { A: 0, B: 0, C: 0, both_bc: 0 };
  SEED_EXPANSIONS.forEach((e) =>
    e.keywords.forEach((kw) => {
      if (kw.sources.length > 1) sourceCounts.both_bc++;
      kw.sources.forEach((s) => (sourceCounts[s] += 1));
    }),
  );

  return (
    <div className="mt-2 space-y-2">
      {effectiveIsMock && (
        <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-50/40 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/20">
          当前展示 DEMO 数据。先跑完 ② 抓种子,再点 ③ 上方的&ldquo;跑 ③ 扩词&rdquo;。
        </div>
      )}
      {/* 顶部统计 + 来源筛选 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs">
        <span className="font-medium">
          {SEED_EXPANSIONS.length} 种子 → {totalKeywords} 词(三路合并去重)
        </span>
        <span className="text-muted-foreground">·</span>
        <button
          type="button"
          onClick={() => setFilterSource(filterSource === 'B' ? 'all' : 'B')}
          className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${
            filterSource === 'B' ? SOURCE_META.B.cls : 'text-muted-foreground ring-border'
          }`}
          title={SOURCE_META.B.tooltip}
        >
          B · Etsy 买家搜索 {sourceCounts.B}
        </button>
        <button
          type="button"
          onClick={() => setFilterSource(filterSource === 'C' ? 'all' : 'C')}
          className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${
            filterSource === 'C' ? SOURCE_META.C.cls : 'text-muted-foreground ring-border'
          }`}
          title={SOURCE_META.C.tooltip}
        >
          C · Listing SEO {sourceCounts.C}
        </button>
        <span className="text-[10px] text-muted-foreground">
          B+C 双源 {sourceCounts.both_bc}
        </span>
        {filterSource !== 'all' && (
          <button
            type="button"
            onClick={() => setFilterSource('all')}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            清除筛选
          </button>
        )}
      </div>

      {/* 来源说明 */}
      <div className="rounded-lg bg-background px-3 py-2 text-[11px] text-muted-foreground ring-1 ring-border">
        <p>
          扩词来源:
          <SourceBadge s="B" /> Etsy 搜索框自动补全(买家真在搜的词);
          <SourceBadge s="C" /> Etsy 头部 listing 标题词组(卖家真在用的 SEO 词)。
          A 路 eRank Related Searches 暂未启用。
        </p>
      </div>

      {/* 按种子分组 */}
      {SEED_EXPANSIONS.map(({ seed, keywords }) => {
        const isOpen = open.has(seed);
        const filtered =
          filterSource === 'all'
            ? keywords
            : keywords.filter((k) => k.sources.includes(filterSource));
        const counts = { A: 0, B: 0, C: 0, both: 0 };
        keywords.forEach((k) => {
          if (k.sources.length > 1) counts.both++;
          k.sources.forEach((s) => (counts[s] += 1));
        });
        return (
          <div key={seed} className="overflow-hidden rounded-xl ring-1 ring-border">
            <button
              type="button"
              onClick={() => toggle(seed)}
              className="flex w-full items-center justify-between gap-2 bg-muted/40 px-3 py-2 text-left hover:bg-muted/60"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">{seed}</span>
                <span className="rounded bg-background px-1.5 py-0.5 text-xs tabular-nums ring-1 ring-border">
                  {keywords.length} 词
                </span>
                {counts.B > 0 && (
                  <span className="text-[10px] text-sky-700">B {counts.B}</span>
                )}
                {counts.C > 0 && (
                  <span className="text-[10px] text-emerald-700">C {counts.C}</span>
                )}
                {counts.both > 0 && (
                  <span className="text-[10px] text-purple-700">B+C {counts.both}</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">{isOpen ? '收起' : '展开'}</span>
            </button>
            {isOpen && (
              <div className="max-h-[300px] overflow-y-auto bg-background">
                {filtered.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-muted-foreground">
                    无 {filterSource} 路扩词
                  </p>
                ) : (
                  <ol className="grid grid-cols-1 gap-x-3 gap-y-0.5 px-3 py-2 font-mono text-[11px] tabular-nums sm:grid-cols-2 lg:grid-cols-3">
                    {filtered.map((kw, i) => (
                      <li
                        key={kw.keyword + i}
                        className="flex items-start gap-1 truncate text-foreground"
                      >
                        <span className="shrink-0 text-muted-foreground">
                          {(i + 1).toString().padStart(2, ' ')}.
                        </span>
                        <div className="flex shrink-0 gap-0.5">
                          {kw.sources.map((s) => (
                            <SourceBadge key={s} s={s} />
                          ))}
                        </div>
                        <span className="truncate">{kw.keyword}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
