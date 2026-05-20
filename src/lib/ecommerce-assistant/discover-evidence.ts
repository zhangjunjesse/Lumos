import type { FetchSamplesResult, MarketProductDetail, MarketSample } from './web-research';

export type SelectionEvidenceStage =
  | 'seed_terms'
  | 'keyword_metrics'
  | 'opportunity_candidates'
  | 'manual_validation_notes'
  | 'product_brief';

export interface SelectionEvidenceRecord extends Record<string, unknown> {
  id?: string;
  research_id: string;
  stage: SelectionEvidenceStage;
  title: string;
  status: 'available' | 'partial' | 'missing';
  summary: string;
  data_json: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface SelectionEvidenceItem {
  stage: SelectionEvidenceStage;
  title: string;
  status: 'available' | 'partial' | 'missing';
  summary: string;
  data: unknown;
}

interface CandidateLike {
  id?: string;
  product_name?: string | null;
  keyword?: string | null;
  category?: string | null;
  score_total?: number | null;
  score_demand?: number | null;
  score_competition?: number | null;
  score_profit?: number | null;
  score_compliance?: number | null;
  score_logistics?: number | null;
  summary?: string | null;
  differentiation?: string | null;
  reference_urls?: string | null;
  source_search_urls?: string | null;
  risks?: string | null;
}

interface SourceAttempt {
  source: string;
  url: string;
  reason: string;
}

export function buildSelectionEvidenceItems(args: {
  researchId: string;
  keyword: string;
  market: string;
  strategyLabel: string;
  liveSamples: FetchSamplesResult[];
  sourceAttempts?: SourceAttempt[];
  candidates?: CandidateLike[];
}): SelectionEvidenceItem[] {
  const seedTerms = buildSeedTerms(
    args.liveSamples,
    args.keyword,
    args.market,
    args.strategyLabel,
    args.sourceAttempts ?? [],
  );
  const metrics = buildKeywordMetrics(args.liveSamples);
  const candidateRows = buildOpportunityCandidates(args.candidates ?? []);
  const validationRows = buildManualValidationNotes(args.candidates ?? [], args.liveSamples);
  const briefs = buildProductBriefs(args.candidates ?? []);
  const hasLiveSeed = args.liveSamples.some((result) => result.samples.length > 0);

  return [
    {
      stage: 'seed_terms',
      title: '原始种子词',
      status: seedTerms.length ? (hasLiveSeed ? 'available' : 'partial') : 'missing',
      summary: seedTerms.length
        ? hasLiveSeed
          ? `已保留 ${seedTerms.length} 条来源种子，可回看它们来自哪个平台和搜索词。`
          : `已记录 ${seedTerms.length} 条平台尝试/输入条件，但没有拿到可用于支撑机会判断的真实样品。`
        : '尚未采到来源种子；不能证明机会是从市场信号收敛而来。',
      data: seedTerms,
    },
    {
      stage: 'keyword_metrics',
      title: '关键词/样品指标表',
      status: metrics.length ? 'partial' : 'missing',
      summary: metrics.length
        ? `已保留 ${metrics.length} 条真实样品指标；eRank 月搜、CTR、KD 尚未接入时标为待补。`
        : '尚无真实样品指标；不能支撑机会判断。',
      data: metrics,
    },
    {
      stage: 'opportunity_candidates',
      title: '机会候选表',
      status: candidateRows.length ? 'available' : 'missing',
      summary: candidateRows.length
        ? `已生成 ${candidateRows.length} 个产品机会候选，并保留 A/B/C 决策依据。`
        : '候选尚未生成；等待 AI 分析完成或查看失败原因。',
      data: candidateRows,
    },
    {
      stage: 'manual_validation_notes',
      title: '人工验证卡',
      status: validationRows.some((r) => r.supporting_sample_count > 0) ? 'partial' : 'missing',
      summary: validationRows.length
        ? '已生成待人工复核清单；评论痛点、利润和供应链仍需人工补证据。'
        : '尚无候选可生成验证卡。',
      data: validationRows,
    },
    {
      stage: 'product_brief',
      title: '产品 brief',
      status: briefs.length ? 'partial' : 'missing',
      summary: briefs.length
        ? '已形成待立项 brief 草案；正式立项前仍需成本、利润和履约确认。'
        : '尚未形成产品 brief。',
      data: briefs,
    },
  ];
}

export function toSelectionEvidenceRecords(args: {
  researchId: string;
  items: SelectionEvidenceItem[];
  now?: string;
}): SelectionEvidenceRecord[] {
  const now = args.now ?? new Date().toISOString();
  return args.items.map((item) => ({
    research_id: args.researchId,
    stage: item.stage,
    title: item.title,
    status: item.status,
    summary: item.summary,
    data_json: JSON.stringify(item.data),
    created_at: now,
    updated_at: now,
  }));
}

function buildSeedTerms(
  results: FetchSamplesResult[],
  fallbackKeyword: string,
  market: string,
  strategyLabel: string,
  sourceAttempts: SourceAttempt[],
) {
  const rows: Array<{
    source_tool: string;
    keyword: string;
    category: string | null;
    market: string | null;
    strategy: string;
    note: string;
  }> = [];
  for (const result of results) {
    const keyword = extractQuery(result.url) || fallbackKeyword;
    rows.push({
      source_tool: result.source,
      keyword,
      category: firstCategory(result.samples, result.details ?? []),
      market,
      strategy: strategyLabel,
      note: result.samples.length
        ? `搜索页采到 ${result.samples.length} 个样品`
        : `未采到样品：${result.warning ?? '空结果'}`,
    });
  }
  if (rows.length === 0) {
    for (const attempt of sourceAttempts) {
      rows.push({
        source_tool: attempt.source,
        keyword: extractQuery(attempt.url) || fallbackKeyword,
        category: null,
        market,
        strategy: strategyLabel,
        note: `未采到样品：${attempt.reason || '空结果'}`,
      });
    }
  }
  return rows;
}

function buildKeywordMetrics(results: FetchSamplesResult[]) {
  return results.flatMap((result) =>
    result.samples.map((sample, index) => ({
      keyword: extractQuery(result.url) || sample.title,
      source_tool: result.source,
      sample_title: sample.title,
      sample_rank: index + 1,
      price: sample.price ?? null,
      rating: sample.rating ?? null,
      reviews: sample.reviews ?? null,
      sales_signal: sample.sales ?? null,
      heat_score: sample.heatScore ?? null,
      search_volume: null,
      clicks: null,
      ctr: null,
      competition: null,
      kd: null,
      trend: null,
      imported_at: result.fetchedAt,
      note: '当前来自平台公开样品；eRank Bulk 指标接入后会补月搜/CTR/KD/竞争。',
    })),
  );
}

function buildOpportunityCandidates(candidates: CandidateLike[]) {
  return candidates.map((candidate) => ({
    candidate_id: candidate.id ?? null,
    opportunity_keyword: candidate.keyword ?? '',
    product_guess: candidate.product_name ?? '',
    category: candidate.category ?? '',
    grade: gradeFromScore(candidate.score_total, candidate.score_profit, candidate.score_competition),
    score_total: candidate.score_total ?? null,
    score_demand: candidate.score_demand ?? null,
    score_competition: candidate.score_competition ?? null,
    score_profit: candidate.score_profit ?? null,
    score_compliance: candidate.score_compliance ?? null,
    score_logistics: candidate.score_logistics ?? null,
    reason: candidate.summary ?? '',
    next_step: nextStepFromScore(candidate.score_total, candidate.score_profit),
    evidence_state: '基于真实样品 + AI 评分；仍需人工验证卡收口。',
  }));
}

function buildManualValidationNotes(candidates: CandidateLike[], results: FetchSamplesResult[]) {
  const details = results.flatMap((r) => r.details ?? []);
  const samples = results.flatMap((r) => r.samples);
  return candidates.map((candidate) => {
    const matched = matchSupportSamples(candidate, samples, details).slice(0, 5);
    return {
      candidate_id: candidate.id ?? null,
      product_guess: candidate.product_name ?? '',
      competitor_ids: matched.map((item) => item.productId ?? item.url ?? item.title),
      supporting_sample_count: matched.length,
      price_band: priceRange(matched),
      review_notes: reviewRange(matched),
      image_style: matched.some((item) => item.imageUrl) ? '已有商品图，可人工比较主图/包装/场景差异' : '图片证据不足',
      risk_notes: parseJsonList(candidate.risks).join('；') || '待补供应链、成本、评论痛点和合规验证',
    };
  });
}

function buildProductBriefs(candidates: CandidateLike[]) {
  return candidates.map((candidate) => ({
    candidate_id: candidate.id ?? null,
    target: candidate.product_name ?? '',
    use_case: candidate.summary ?? '待从样品和评论继续拆解',
    value_prop: candidate.differentiation ?? '待补差异化',
    cost: '待补采购/制作、包装、物流、平台费、广告预算',
    profit: candidate.score_profit != null ? `利润分 ${candidate.score_profit}，不能替代真实毛利测算` : '待补',
    abc: gradeFromScore(candidate.score_total, candidate.score_profit, candidate.score_competition),
    action: nextStepFromScore(candidate.score_total, candidate.score_profit),
  }));
}

function matchSupportSamples(
  candidate: CandidateLike,
  samples: MarketSample[],
  details: MarketProductDetail[],
): Array<MarketSample | MarketProductDetail> {
  const haystack = [
    candidate.product_name,
    candidate.summary,
    candidate.differentiation,
    candidate.keyword,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return [...details, ...samples]
    .map((sample) => {
      const hits = sample.title
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 4 && haystack.includes(word)).length;
      const detailBonus = 'rank' in sample ? 2 : 0;
      return { sample, score: hits + detailBonus };
    })
    .sort((a, b) => b.score - a.score)
    .map((item) => item.sample);
}

function firstCategory(samples: MarketSample[], details: MarketProductDetail[]): string | null {
  return details.find((d) => d.category)?.category ?? samples.find((s) => s.category)?.category ?? null;
}

function extractQuery(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('q') || parsed.searchParams.get('k') || parsed.searchParams.get('keyword');
  } catch {
    return null;
  }
}

function priceRange(items: Array<MarketSample | MarketProductDetail>): string {
  const values = items.map((item) => item.price).filter((v): v is string => Boolean(v));
  if (!values.length) return '待补';
  return values.length === 1 ? values[0] : `${values[0]} - ${values[values.length - 1]}`;
}

function reviewRange(items: Array<MarketSample | MarketProductDetail>): string {
  const values = items.map((item) => item.reviews).filter((v): v is string => Boolean(v));
  if (!values.length) return '评论字段待补';
  return `样品评论数：${values.slice(0, 5).join(' / ')}`;
}

function gradeFromScore(
  score?: number | null,
  profit?: number | null,
  competition?: number | null,
): 'A' | 'B' | 'C' {
  const total = score ?? 0;
  if (total >= 78 && (profit ?? 100) >= 55 && (competition ?? 100) >= 50) return 'A';
  if (total >= 60 && (profit ?? 100) >= 55) return 'B';
  return 'C';
}

function nextStepFromScore(score?: number | null, profit?: number | null): string {
  if ((score ?? 0) >= 78 && (profit ?? 100) >= 55) {
    return '补成本表和供应链，确认后进入小批量打样/上新准备';
  }
  if ((score ?? 0) >= 60) return '补竞品痛点、价格带和供应链验证后再决定';
  return '保留记录，换更窄关键词或补样品后重跑';
}

function parseJsonList(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}
