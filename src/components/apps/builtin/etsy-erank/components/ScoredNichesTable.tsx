'use client';

import * as React from 'react';

import { BULK_METRICS_REAL, LISTING_GALLERY, SCORED_NICHES as MOCK_SCORED } from '../mock-data';
import type { BulkMetric, ConfidenceLevel, Grade, ScoredNiche } from '../etsy-erank-types';

const CONFIDENCE_META: Record<ConfidenceLevel, { label: string; cls: string; tooltip: string }> = {
  high: {
    label: '高',
    cls: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30',
    tooltip: 'LLM 训练数据里有这词,判断可靠',
  },
  medium: {
    label: '中',
    cls: 'bg-amber-500/10 text-amber-700 ring-amber-500/30',
    tooltip: 'LLM 半懂(可能多义/小众),建议自己上网查证',
  },
  low: {
    label: '低',
    cls: 'bg-red-500/10 text-red-700 ring-red-500/30',
    tooltip: 'LLM 完全陌生,必须自己上网查证',
  },
};

const GRADE_META: Record<Grade, { label: string; cls: string }> = {
  A: { label: 'A', cls: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/30' },
  B: { label: 'B', cls: 'bg-sky-500/10 text-sky-700 ring-sky-500/30' },
  C: { label: 'C', cls: 'bg-amber-500/10 text-amber-700 ring-amber-500/30' },
  drop: { label: '✗', cls: 'bg-muted text-muted-foreground ring-border' },
};

type RiskType = 'ip' | 'trend' | 'supply' | 'cultural' | 'audience' | 'data' | 'other';

const RISK_META: Record<RiskType, { icon: string; label: string; cls: string }> = {
  ip:       { icon: '🚨', label: 'IP 版权',  cls: 'bg-red-500/10 text-red-700 ring-red-500/30' },
  trend:    { icon: '⏱',  label: '趋势窗口', cls: 'bg-orange-500/10 text-orange-700 ring-orange-500/30' },
  supply:   { icon: '🛠', label: '供应链',   cls: 'bg-stone-500/10 text-stone-700 ring-stone-500/30' },
  cultural: { icon: '🎭', label: '议题/文化', cls: 'bg-purple-500/10 text-purple-700 ring-purple-500/30' },
  audience: { icon: '🎯', label: '目标群体', cls: 'bg-sky-500/10 text-sky-700 ring-sky-500/30' },
  data:     { icon: '📉', label: '数据信心', cls: 'bg-amber-500/10 text-amber-700 ring-amber-500/30' },
  other:    { icon: '⚠',  label: '其它风险', cls: 'bg-muted text-muted-foreground ring-border' },
};

// 按文本关键词把 niche_risks 自由文本归类
function classifyRisk(text: string): RiskType {
  const t = text.toLowerCase();
  if (/ip|版权|侵权|授权|fan art|商标|disney|mattel|andy weir/.test(t)) return 'ip';
  if (/趋势|窗口|滞后|y2k|frutiger|cottagecore|风口|社交平台/.test(t)) return 'trend';
  if (/供应链|工厂|起订|物流|生产/.test(t)) return 'supply';
  if (/议题|文化|敏感|公益|awareness|社区/.test(t)) return 'cultural';
  if (/群体|亚文化|小众|圈层|粉丝/.test(t)) return 'audience';
  if (/数据|信心|聚合|滞后|未必/.test(t)) return 'data';
  return 'other';
}

// 从 ④ BULK_METRICS_REAL 查 keyword 对应的 grade + metrics
const metricsMap = new Map<string, BulkMetric>(
  BULK_METRICS_REAL.map((m) => [m.keyword, m]),
);

type SortKey = 'a_count' | 'top_a' | 'risks';

function CandidateRow({ keyword, productGuess, rationale, confidence, nextStep }: {
  keyword: string;
  productGuess: string;
  rationale: string;
  confidence: ConfidenceLevel;
  nextStep: string;
}) {
  const [open, setOpen] = React.useState(false);
  const metric = metricsMap.get(keyword);
  const grade = (metric?.grade ?? 'C') as Grade;
  const g = GRADE_META[grade];
  const cm = CONFIDENCE_META[confidence];

  return (
    <div className="rounded-lg ring-1 ring-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 bg-background px-3 py-2 text-left text-xs hover:bg-muted/30"
      >
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${g.cls}`}>
          {g.label}
        </span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ring-1 ${cm.cls}`}
          title={cm.tooltip}
        >
          {cm.label}
        </span>
        <span className="shrink-0 font-mono font-semibold text-foreground">{keyword}</span>
        <span className="truncate text-muted-foreground">· {productGuess}</span>
        {metric && (
          <span className="ml-auto flex shrink-0 gap-1 text-[10px] tabular-nums text-muted-foreground">
            <span className="rounded bg-muted px-1.5 py-0.5">月搜 {metric.searches}</span>
            <span className="rounded bg-muted px-1.5 py-0.5">KD {metric.kd}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 hidden md:inline">竞争 {metric.competition}</span>
          </span>
        )}
        <span className="shrink-0 text-[10px] text-muted-foreground ml-1">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="space-y-2 bg-muted/20 px-3 py-2 text-[11px]">
          <p className="text-muted-foreground leading-relaxed">{rationale}</p>
          <p className="text-emerald-700">
            <span className="font-medium">下一步: </span>
            {nextStep}
          </p>
          {metric && (
            <p className="text-[10px] text-muted-foreground tabular-nums">
              metrics 全: 月搜 {metric.searches} · 月点 {metric.clicks} · CTR {metric.ctr} · 竞争 {metric.competition} · KD {metric.kd} · Google {metric.google}
            </p>
          )}
          {grade === 'A' && (
            <p className="text-[10px] text-amber-700">
              → 已自动进入 ⑥ 商业分析(EHunt 注入 + 头部 24 listing 聚合)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function NicheCard({ niche }: { niche: ScoredNiche }) {
  const [open, setOpen] = React.useState(false);
  const { stats } = niche;
  const riskTypes = React.useMemo(() => {
    const set = new Set<RiskType>();
    niche.niche_risks.forEach((r) => set.add(classifyRisk(r)));
    return [...set];
  }, [niche.niche_risks]);
  const gallery = LISTING_GALLERY[niche.seed] ?? [];

  return (
    <div className="overflow-hidden rounded-xl ring-1 ring-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-start justify-between gap-3 bg-muted/40 px-3 py-2.5 text-left hover:bg-muted/60"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-semibold">{niche.seed}</span>
            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 ring-1 ring-emerald-500/30">
              A {stats.a_count}
            </span>
            {stats.b_count > 0 && (
              <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-700 ring-1 ring-sky-500/30">
                B {stats.b_count}
              </span>
            )}
            {stats.c_count > 0 && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-700 ring-1 ring-amber-500/30">
                C {stats.c_count}
              </span>
            )}
            <span className="text-[10px] tabular-nums text-muted-foreground">
              顶 A 月搜 {stats.top_a_searches.toLocaleString()}
            </span>
            {/* niche 风险分类徽章 */}
            {riskTypes.map((t) => {
              const m = RISK_META[t];
              return (
                <span
                  key={t}
                  className={`rounded-full px-2 py-0.5 text-[10px] ring-1 ${m.cls}`}
                  title={niche.niche_risks.filter((r) => classifyRisk(r) === t).join(' / ')}
                >
                  {m.icon} {m.label}
                </span>
              );
            })}
          </div>
          {/* Etsy 头部 listing 缩略带(让用户秒看 niche 长啥样) */}
          {gallery.length > 0 && (
            <div className="mt-2 flex gap-1.5">
              {gallery.slice(0, 6).map((l) => (
                <img
                  key={l.listing_id}
                  src={l.img}
                  alt={l.title}
                  title={l.title + (l.price ? ' · ' + l.price : '')}
                  className="h-12 w-12 shrink-0 rounded-md object-cover ring-1 ring-border"
                  loading="lazy"
                />
              ))}
            </div>
          )}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="space-y-3 bg-background px-3 py-3 text-xs">
          {/* niche_summary */}
          <div className="rounded-lg bg-muted/30 px-3 py-2 leading-relaxed text-foreground">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              战略总结
            </p>
            <p>{niche.niche_summary}</p>
          </div>

          {/* niche_risks 详情(按类型分组) */}
          {niche.niche_risks.length > 0 && (
            <div className="space-y-1.5">
              {riskTypes.map((t) => {
                const m = RISK_META[t];
                const items = niche.niche_risks.filter((r) => classifyRisk(r) === t);
                return (
                  <div key={t} className={`rounded-lg px-3 py-2 ring-1 ${m.cls}`}>
                    <p className="text-[10px] font-medium">
                      {m.icon} {m.label}
                    </p>
                    {items.map((r, i) => (
                      <p key={i} className="mt-0.5 leading-relaxed">{r}</p>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {/* Etsy 头部 listing 完整图集(竞品图集,⑥ 验证"图片差异化"维度可看) */}
          {gallery.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Etsy 头部 listing({gallery.length})· 竞品图集
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {gallery.map((l) => (
                  <a
                    key={l.listing_id}
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block overflow-hidden rounded-lg ring-1 ring-border hover:ring-foreground/40"
                  >
                    <img
                      src={l.img}
                      alt={l.title}
                      className="aspect-square w-full object-cover transition group-hover:scale-105"
                      loading="lazy"
                    />
                    <div className="space-y-0.5 px-2 py-1.5">
                      <p className="line-clamp-2 text-[10px] text-foreground">{l.title}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold tabular-nums text-emerald-700">
                          {l.price}
                        </span>
                        {l.shop && (
                          <span className="truncate text-[9px] text-muted-foreground">
                            {l.shop}
                          </span>
                        )}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* candidates(默认折叠) */}
          <div className="space-y-1.5">
            {niche.candidates.map((c) => (
              <CandidateRow key={c.keyword} {...c} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export interface ScoredNichesTableProps {
  niches?: ScoredNiche[];
  isMock?: boolean;
}

export function ScoredNichesTable({ niches, isMock }: ScoredNichesTableProps = {}): React.ReactElement {
  const SCORED_NICHES = niches ?? MOCK_SCORED;
  const effectiveIsMock = isMock ?? !niches;
  const [sortBy, setSortBy] = React.useState<SortKey>('a_count');

  const sorted = React.useMemo(() => {
    return [...SCORED_NICHES].sort((a, b) => {
      if (sortBy === 'a_count') {
        return b.stats.a_count - a.stats.a_count ||
          b.stats.top_a_searches - a.stats.top_a_searches;
      }
      if (sortBy === 'top_a') return b.stats.top_a_searches - a.stats.top_a_searches;
      if (sortBy === 'risks') return a.stats.risks_count - b.stats.risks_count;
      return 0;
    });
  }, [sortBy, SCORED_NICHES]);

  return (
    <div className="mt-2 space-y-2">
      {effectiveIsMock && (
        <div className="rounded-lg border border-dashed border-amber-500/40 bg-amber-50/40 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-950/20">
          当前展示 DEMO 数据。先跑完 ④ Bulk 验真,再点 ⑤ 上方的&ldquo;跑 ⑤ AI 解读&rdquo;。
        </div>
      )}
      {/* A/B/C 等级 + 高/中/低 信心 说明 */}
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs leading-relaxed">
        <div className="mb-1 font-semibold text-foreground">A / B / C 是什么(关键词等级,code 算)</div>
        <div className="text-muted-foreground">
          ④ Bulk 验真时按硬规则打的等级,LLM 不算分,只做产品/风险解读:<br />
          ·&nbsp; <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-500/30">A</span>
          <span className="text-foreground"> 顶级金矿</span> —— 月搜 ≥ 150 且 竞争 &lt; 5,000 且 KD &lt; 30 且 CTR ≥ 80% (需求强 + 供给少 + SEO 易)<br />
          ·&nbsp; <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-sky-500/30">B</span>
          <span className="text-foreground"> 可切候选</span> —— 月搜 ≥ 100 且 竞争 &lt; 50,000 且 KD &lt; 50 且 CTR ≥ 80%<br />
          ·&nbsp; <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-500/30">C</span>
          <span className="text-foreground"> 副词/陪衬</span> —— 月搜 ≥ 100,但 KD 或竞争超过 B 阈值(适合做标题副词,不单独冲)<br />
          ·&nbsp; 其它(月搜 &lt; 100 / KD = 100 / 数据缺失 / 竞争 &gt; 10 万)= drop,不进 ⑤
        </div>

        <div className="mt-2 mb-1 font-semibold text-foreground">高 / 中 / 低 是什么(LLM 自评把握度)</div>
        <div className="text-muted-foreground">
          LLM 对自己解读这词时的信心,告诉你&ldquo;这条产品建议是否要自己上网再查&rdquo;:<br />
          ·&nbsp; <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-700 ring-1 ring-emerald-500/30">高</span>
          <span className="text-foreground"> LLM 训练数据里有这词</span>(autism pin / ita bag / frutiger aero 这类),判断可靠,可直接用<br />
          ·&nbsp; <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 ring-1 ring-amber-500/30">中</span>
          <span className="text-foreground"> LLM 半懂</span>(知道这词但 Etsy 销售形态不熟,如 katana / hanbok),**建议自己上网查证**<br />
          ·&nbsp; <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-700 ring-1 ring-red-500/30">低</span>
          <span className="text-foreground"> LLM 完全陌生</span>(plannerkate1 / vantastiks 这类小众词),**必须自己上网查证**
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs">
        <span className="font-medium">
          {SCORED_NICHES.length} niche · {SCORED_NICHES.reduce((n, x) => n + x.candidates.length, 0)} 候选 LLM 解读完成
        </span>
        <div className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          排序:
          {(['a_count', 'top_a', 'risks'] as SortKey[]).map((k) => (
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
              {{ a_count: 'A 级数 ↓', top_a: '顶 A 月搜 ↓', risks: '风险最少 ↑' }[k]}
            </button>
          ))}
        </div>
      </div>

      {sorted.map((niche) => (
        <NicheCard key={niche.seed} niche={niche} />
      ))}

      <p className="text-[11px] text-muted-foreground">
        点候选行展开看 LLM rationale + 下一步建议 + 完整 metrics。决策权在你 — 上面排序按钮挑想做的 niche。
      </p>
    </div>
  );
}
