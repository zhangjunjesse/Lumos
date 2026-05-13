import { z } from 'zod';
import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { generateImages } from '@/lib/image';
import { generateStructured, EcommerceLlmUnavailableError } from './llm-client';
import { persistImageBuffer } from './upload';
import {
  buildPlatformSearchUrl,
  fetchSearchSamples,
  type FetchSamplesResult,
  type MarketProductDetail,
  type MarketSample,
} from './web-research';
import {
  createCandidate,
  patchCandidate,
  setCandidateStatus,
  getCandidate,
  upsertBrief,
  getEcommerceStore,
  type DiscoverCandidateRow,
} from './storage';

const referenceUrlObjectSchema = z.object({
  platform: z.string().min(1),
  url: z.string().url(),
  label: z.string().optional(),
});

const referenceUrlSchema = z.union([
  referenceUrlObjectSchema,
  z.string().trim().url().transform((url) => ({
    platform: inferReferencePlatform(url),
    url,
  })),
]);

const candidateSchema = z.object({
  product_name: z.string().min(1),
  category: z.string().min(1),
  estimated_price_usd: z.number().positive().optional(),
  score_demand: z.number().int().min(0).max(100).default(50),
  score_competition: z.number().int().min(0).max(100).default(50),
  score_profit: z.number().int().min(0).max(100).default(50),
  score_compliance: z.number().int().min(0).max(100).default(80),
  score_logistics: z.number().int().min(0).max(100).default(70),
  summary: z.string().min(1),
  selling_points: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  differentiation: z
    .string()
    .min(1)
    .describe(
      'one-paragraph: based on which competitor pain point, what concrete differentiation do you propose',
    ),
  reference_urls: z
    .array(referenceUrlSchema)
    .min(2)
    .describe('real platform SEARCH urls (not fake product detail urls). 2-4 entries.'),
  source_search_urls: z
    .array(referenceUrlSchema)
    .min(1)
    .describe('1688 / Alibaba / AliExpress SEARCH urls for sourcing this product. 1-3 entries.'),
});

const researchSchema = z.object({
  candidates: z.array(candidateSchema).min(1).max(10),
});

const DEFAULT_DISCOVER_SAMPLE_COUNT = 12;
const MAX_DISCOVER_SAMPLE_COUNT = 30;

function inferReferencePlatform(rawUrl: string): string {
  try {
    const hostname = new URL(rawUrl).hostname.replace(/^www\./i, '').toLowerCase();
    if (hostname.includes('etsy.')) return 'Etsy';
    if (hostname.includes('amazon.')) return 'Amazon';
    if (hostname.includes('walmart.')) return 'Walmart';
    if (hostname.includes('1688.')) return '1688';
    if (hostname.includes('alibaba.')) return 'Alibaba';
    if (hostname.includes('aliexpress.')) return 'AliExpress';
    if (hostname.includes('shopify.')) return 'Shopify';
    return hostname || '来源链接';
  } catch {
    return '来源链接';
  }
}

type SelectionStrategyId =
  | 'blue-ocean'
  | 'follow-trend'
  | 'seasonal'
  | 'big-sale'
  | 'evergreen';

interface SelectionStrategyRule {
  id: SelectionStrategyId;
  label: string;
  weights: {
    demand: number;
    competition: number;
    profit: number;
    compliance: number;
    logistics: number;
  };
  promptRule: string;
}

const DEFAULT_STRATEGY_ID: SelectionStrategyId = 'blue-ocean';

const SELECTION_STRATEGIES: Record<SelectionStrategyId, SelectionStrategyRule> = {
  'blue-ocean': {
    id: 'blue-ocean',
    label: '蓝海',
    weights: { demand: 0.2, competition: 0.4, profit: 0.2, compliance: 0.1, logistics: 0.1 },
    promptRule:
      'Blue-ocean strategy: prioritize lower competition and concrete differentiation. Penalize saturated commodity products even if demand is high.',
  },
  'follow-trend': {
    id: 'follow-trend',
    label: '跟风',
    weights: { demand: 0.42, competition: 0.12, profit: 0.2, compliance: 0.1, logistics: 0.16 },
    promptRule:
      'Follow-trend strategy: prioritize visible demand velocity, social proof, and easy fulfillment. Accept more competition only when differentiation and margin are still plausible.',
  },
  seasonal: {
    id: 'seasonal',
    label: '季节性',
    weights: { demand: 0.34, competition: 0.16, profit: 0.2, compliance: 0.15, logistics: 0.15 },
    promptRule:
      'Seasonal strategy: prioritize products with a clear seasonal use case and near-term demand window. Penalize slow logistics, fragile supply, or compliance risk that would miss the season.',
  },
  'big-sale': {
    id: 'big-sale',
    label: '大促',
    weights: { demand: 0.25, competition: 0.15, profit: 0.25, compliance: 0.1, logistics: 0.25 },
    promptRule:
      'Big-sale strategy: prioritize scalable supply, logistics resilience, bundle potential, and discountable margin. Penalize bulky, fragile, or low-stock concepts.',
  },
  evergreen: {
    id: 'evergreen',
    label: '常青款',
    weights: { demand: 0.3, competition: 0.2, profit: 0.2, compliance: 0.15, logistics: 0.15 },
    promptRule:
      'Evergreen strategy: prioritize stable repeat demand, low compliance friction, and durable everyday utility. Penalize fad-only novelty.',
  },
};

export interface ResearchInput {
  keyword: string;
  market: string;
  priceBand?: string | null;
  platformFocus?: string[];
  strategy?: string | null;
  count?: number;
  sampleCount?: number;
  hotSellingOnly?: boolean;
}

export interface ResearchOutcome {
  researchId: string;
  candidates: DiscoverCandidateRow[];
}

export interface StartedResearchOutcome {
  researchId: string;
  placeholder: DiscoverCandidateRow;
}

export interface PromoteOutcome {
  candidate: DiscoverCandidateRow;
  inputId: string;
  conceptImagePath: string | null;
  conceptImageFailed: string | null;
}

export class DiscoverResearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoverResearchError';
  }
}

/**
 * Thrown when ALL configured platforms failed to return live samples (network
 * down, blocked by anti-bot, China-mainland accessing amazon.com without VPN,
 * etc). We deliberately refuse to fall back to "model-only candidates" because
 * those are LLM-fabricated product concepts.
 */
export class DiscoverNoLiveDataError extends DiscoverResearchError {
  attempts: { source: string; url: string; reason: string }[];

  constructor(attempts: { source: string; url: string; reason: string }[]) {
    const lines = attempts.map((a) => `  · ${a.source}: ${a.reason}`).join('\n');
    super(
      [
        '无法从任何目标平台获取真实样品数据，已拒绝退回到模型估算（避免生成虚构产品）。',
        '尝试与失败原因：',
        lines,
        '',
        '建议：',
        '  - 中国大陆访问 amazon.com / etsy.com 需开启 VPN',
        '  - 短期内多次请求可能被平台临时反爬，等 5 分钟再试',
        '  - 切换其他目标平台（如 walmart）或检查关键词是否合理',
      ].join('\n'),
    );
    this.name = 'DiscoverNoLiveDataError';
    this.attempts = attempts;
  }
}

export async function runDiscoverResearch(
  store: AppDataStore,
  input: ResearchInput,
  abortSignal?: AbortSignal,
): Promise<ResearchOutcome> {
  const started = createResearchPlaceholder(store, input);
  return completeDiscoverResearch(store, input, started, abortSignal);
}

export function startDiscoverResearch(
  store: AppDataStore,
  input: ResearchInput,
): StartedResearchOutcome {
  const started = createResearchPlaceholder(store, input);
  void completeDiscoverResearch(getFreshEcommerceStore(), input, started).catch((err) => {
    // completeDiscoverResearch writes the visible failed state; keep this log
    // for local diagnostics if the failure happens outside its guarded sections.
    console.error('[ecommerce-discover] background research failed', err);
  });
  return { researchId: started.researchId, placeholder: started.placeholder };
}

function createResearchPlaceholder(
  store: AppDataStore,
  input: ResearchInput,
): { researchId: string; strategy: SelectionStrategyRule; placeholder: DiscoverCandidateRow } {
  const researchId = `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const strategy = resolveSelectionStrategy(input.strategy);
  const placeholder = createCandidate(store, {
    research_id: researchId,
    keyword: input.keyword,
    market: input.market,
    price_band: input.priceBand ?? null,
    platform_focus: JSON.stringify(input.platformFocus ?? []),
    strategy: strategy.id,
    sources: JSON.stringify([
      {
        kind: 'research-preferences',
        hot_selling_only: Boolean(input.hotSellingOnly),
        sample_count: resolveDiscoverSampleCount(input.sampleCount),
      },
    ]),
    product_name: '研究中…',
    category: '',
    status: 'researching',
  });
  return { researchId, strategy, placeholder };
}

async function completeDiscoverResearch(
  store: AppDataStore,
  input: ResearchInput,
  started: { researchId: string; strategy: SelectionStrategyRule; placeholder: DiscoverCandidateRow },
  abortSignal?: AbortSignal,
): Promise<ResearchOutcome> {
  const { researchId, strategy, placeholder } = started;
  const liveSamples = await fetchSamplesForResearch(store, input, abortSignal);
  const usable = liveSamples.filter((r) => r.samples.length > 0);
  if (usable.length === 0) {
    const attempts = liveSamples.length > 0
      ? liveSamples.map((r) => ({
          source: r.source,
          url: r.url,
          reason: r.warning ?? '空结果',
        }))
      : [
          {
            source: input.platformFocus?.[0] ?? 'unknown',
            url: '',
            reason: '没有可用的平台 fetcher（请选 Amazon/Etsy/Walmart/TikTok Shop 等支持联网抓取的平台）',
          },
        ];
    const err = new DiscoverNoLiveDataError(attempts);
    setCandidateStatus(store, placeholder.id, 'failed', {
      failure_reason: err.message,
      sources: JSON.stringify(buildSourcesEntry(liveSamples, strategy, input)),
    });
    throw err;
  }

  try {
    const data = await generateStructured({
      schema: researchSchema,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(input, liveSamples, strategy),
      abortSignal,
      maxTokens: 6144,
    });
    store.delete('discover_candidates', placeholder.id);

    const rows: DiscoverCandidateRow[] = [];
    for (const c of data.candidates) {
      const total = computeTotal(c, strategy);
      const referenceUrls = normalizeReferenceUrls(c.reference_urls);
      const sourceSearchUrls = normalizeReferenceUrls(c.source_search_urls);
      const row = createCandidate(store, {
        research_id: researchId,
        keyword: input.keyword,
        market: input.market,
        price_band: input.priceBand ?? null,
        platform_focus: JSON.stringify(input.platformFocus ?? []),
        strategy: strategy.id,
        product_name: c.product_name,
        category: c.category,
        estimated_price_usd: c.estimated_price_usd ?? null,
        score_demand: c.score_demand,
        score_competition: c.score_competition,
        score_profit: c.score_profit,
        score_compliance: c.score_compliance,
        score_logistics: c.score_logistics,
        score_total: total,
        summary: c.summary,
        selling_points: JSON.stringify(c.selling_points),
        risks: JSON.stringify(c.risks),
        differentiation: c.differentiation,
        reference_urls: JSON.stringify(referenceUrls),
        source_search_urls: JSON.stringify(sourceSearchUrls),
        sources: JSON.stringify(buildSourcesEntry(liveSamples, strategy, input)),
        status: 'ready',
      });
      rows.push(row);
    }
    return { researchId, candidates: rows };
  } catch (err) {
    setCandidateStatus(store, placeholder.id, 'failed', {
      failure_reason: err instanceof Error ? err.message : String(err),
      sources: JSON.stringify(buildSourcesEntry(liveSamples, strategy, input)),
    });
    if (err instanceof EcommerceLlmUnavailableError) throw err;
    throw new DiscoverResearchError(err instanceof Error ? err.message : String(err));
  }
}

function normalizeReferenceUrls(values: unknown): Array<z.infer<typeof referenceUrlObjectSchema>> {
  if (!Array.isArray(values)) return [];
  const out: Array<z.infer<typeof referenceUrlObjectSchema>> = [];
  for (const value of values) {
    const parsed = referenceUrlSchema.safeParse(value);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function getFreshEcommerceStore(): AppDataStore {
  return getEcommerceStore();
}

export async function promoteCandidateToInput(
  store: AppDataStore,
  candidateId: string,
  abortSignal?: AbortSignal,
): Promise<PromoteOutcome> {
  const candidate = getCandidate(store, candidateId);
  if (!candidate) {
    throw new DiscoverResearchError(`候选不存在：${candidateId}`);
  }
  if (candidate.status === 'promoted' && candidate.promoted_input_id) {
    return {
      candidate,
      inputId: candidate.promoted_input_id,
      conceptImagePath: candidate.concept_image_path ?? null,
      conceptImageFailed: candidate.concept_image_failed ?? null,
    };
  }

  let conceptImagePath: string | null = candidate.concept_image_path ?? null;
  let conceptImageFailed: string | null = null;
  if (!conceptImagePath) {
    try {
      const result = await generateImages({
        prompt: buildConceptImagePrompt(candidate),
        aspectRatio: '4:5',
        n: 1,
        abortSignal,
      });
      const first = result.images?.[0];
      conceptImagePath = first?.localPath ?? null;
      if (!conceptImagePath) {
        conceptImageFailed = '图像服务商返回空结果。';
      }
    } catch (err) {
      conceptImageFailed = err instanceof Error ? err.message : String(err);
    }
  }

  const realImage = await tryPersistCandidateProductImage(candidate, abortSignal);
  const note = buildNoteFromCandidate(candidate, realImage);
  const created = store.create('product_inputs', {
    title: candidate.product_name,
    category_hint: candidate.category,
    main_image_path: realImage.path ?? '',
    status: 'ready',
    note,
  });
  const inputId = (created as { id: string }).id;

  // Synthesize a brief from the candidate so listing-drafter can run BEFORE
  // any image SOP. Confidence is intentionally low (4) because this is
  // synthesized from a sourcing analyst's hypothesis, not from a real photo.
  synthesizeBriefFromCandidate(store, inputId, candidate);

  const updated = patchCandidate(store, candidateId, {
    status: 'promoted',
    promoted_input_id: inputId,
    concept_image_path: conceptImagePath,
    concept_image_failed: conceptImageFailed,
  });
  return {
    candidate: updated ?? candidate,
    inputId,
    conceptImagePath,
    conceptImageFailed,
  };
}

function synthesizeBriefFromCandidate(
  store: AppDataStore,
  inputId: string,
  c: DiscoverCandidateRow,
): void {
  const points = safeParseList<string>(c.selling_points);
  const risks = safeParseList<string>(c.risks);
  const briefBlock = {
    productType: c.product_name,
    categoryBucket: c.category,
    sizeClass: 'medium',
    coreSellingPoints: points,
    targetAudience: [],
    recommendedAspectRatio: '4:5',
    recommendedShotType: 'tabletop',
    fidelityFocus: [],
    consistencyAnchors: [],
    avoidElements: risks,
  };
  const raw = JSON.stringify({
    source: 'discover-promoted',
    candidate_id: c.id,
    keyword: c.keyword,
    market: c.market,
    differentiation: c.differentiation,
    summary: c.summary,
    note: 'Synthesized from sourcing analyst hypothesis; replace with real-photo brief once a SOP image job runs.',
  });
  upsertBrief(store, { input_id: inputId, brief: briefBlock, raw, confidence: 4 });
}

function resolveSelectionStrategy(raw?: string | null): SelectionStrategyRule {
  const normalized = raw?.trim() as SelectionStrategyId | undefined;
  return normalized && SELECTION_STRATEGIES[normalized]
    ? SELECTION_STRATEGIES[normalized]
    : SELECTION_STRATEGIES[DEFAULT_STRATEGY_ID];
}

function computeTotal(c: z.infer<typeof candidateSchema>, strategy: SelectionStrategyRule): number {
  const w = strategy.weights;
  const sum = w.demand + w.competition + w.profit + w.compliance + w.logistics;
  const value =
    c.score_demand * w.demand +
    c.score_competition * w.competition +
    c.score_profit * w.profit +
    c.score_compliance * w.compliance +
    c.score_logistics * w.logistics;
  return Math.round(value / sum);
}

function buildNoteFromCandidate(
  c: DiscoverCandidateRow,
  realImage: { path: string | null; failureReason: string | null },
): string {
  const points = safeParseList<string>(c.selling_points);
  const risks = safeParseList<string>(c.risks);
  const refs = safeParseList<{ platform: string; url: string }>(c.reference_urls);
  const sources = safeParseList<{ platform: string; url: string }>(c.source_search_urls);
  const details = extractCandidateDetails(c);
  return [
    `[来自选品] ${c.keyword} · ${c.market}`,
    `类目：${c.category}`,
    c.estimated_price_usd ? `预估价：$${c.estimated_price_usd}` : null,
    c.score_total != null ? `综合分：${c.score_total}` : null,
    c.summary ? `摘要：${c.summary}` : null,
    c.differentiation ? `差异化：${c.differentiation}` : null,
    points.length ? `卖点：${points.join('；')}` : null,
    risks.length ? `风险：${risks.join('；')}` : null,
    refs.length
      ? `参考竞品：\n${refs.map((r) => `  · ${r.platform}: ${r.url}`).join('\n')}`
      : null,
    sources.length
      ? `货源搜索：\n${sources.map((r) => `  · ${r.platform}: ${r.url}`).join('\n')}`
      : null,
    details.length
      ? `真实商品详情：\n${details
          .slice(0, 3)
          .map((d) => `  · ${d.source} #${d.rank}: ${d.title}${d.price ? ` · ${d.price}` : ''} · ${d.url}`)
          .join('\n')}`
      : null,
    realImage.path
      ? '主图：已自动保存真实商品详情页图片，可直接进入工坊出图；如图片不符合你的样品，请替换。'
      : realImage.failureReason
        ? `主图：真实商品图自动保存失败（${realImage.failureReason}），请上传真实样品照后再启动出图任务。`
        : c.concept_image_path
          ? '主图：已自动生成 AI 概念图，仅供参考；出图 SOP 仍需真实样品图。'
          : '主图：未获取到可用真实商品图，请上传真实样品照后再启动出图任务。',
  ]
    .filter(Boolean)
    .join('\n');
}

async function tryPersistCandidateProductImage(
  c: DiscoverCandidateRow,
  abortSignal?: AbortSignal,
): Promise<{ path: string | null; failureReason: string | null }> {
  const detail = extractCandidateDetails(c).find((item) => item.imageUrl);
  if (!detail?.imageUrl) {
    return { path: null, failureReason: null };
  }
  try {
    const res = await fetch(detail.imageUrl, { signal: abortSignal, redirect: 'follow' });
    if (!res.ok) return { path: null, failureReason: `HTTP ${res.status}` };
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await res.arrayBuffer());
    const saved = persistImageBuffer({
      buffer,
      filename: `candidate-${c.id ?? 'product'}.${extensionFromContentType(contentType)}`,
      mimeType: contentType,
    });
    return { path: saved.absolutePath, failureReason: null };
  } catch (err) {
    return { path: null, failureReason: err instanceof Error ? err.message : String(err) };
  }
}

function extensionFromContentType(contentType: string): string {
  const mime = contentType.split(';')[0]?.trim().toLowerCase();
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'jpg';
}

function extractCandidateDetails(c: DiscoverCandidateRow): MarketProductDetail[] {
  type RawDetail = Partial<MarketProductDetail> & {
    image_url?: string | null;
    gallery_image_urls?: string[];
    product_id?: string | null;
    bullet_points?: string[];
    review_snippets?: string[];
    fetched_at?: string;
    fetched_via?: 'browser' | 'server-fetch';
  };
  const entries = safeParseList<{ source?: string; details?: RawDetail[] }>(c.sources);
  const details: MarketProductDetail[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry.details)) continue;
    for (const raw of entry.details) {
      if (typeof raw.title !== 'string' || typeof raw.url !== 'string') continue;
      details.push({
        source: raw.source ?? entry.source ?? 'unknown',
        rank: Number(raw.rank ?? 0) || 0,
        title: raw.title,
        url: raw.url,
        productId: raw.productId ?? raw.product_id ?? undefined,
        price: raw.price,
        rating: raw.rating,
        reviews: raw.reviews,
        sales: raw.sales,
        brand: raw.brand,
        category: raw.category,
        availability: raw.availability,
        bulletPoints: raw.bulletPoints ?? raw.bullet_points ?? [],
        description: raw.description,
        imageUrl: raw.imageUrl ?? raw.image_url ?? undefined,
        galleryImageUrls: raw.galleryImageUrls ?? raw.gallery_image_urls ?? [],
        reviewSnippets: raw.reviewSnippets ?? raw.review_snippets ?? [],
        badges: raw.badges ?? [],
        fetchedAt: raw.fetchedAt ?? raw.fetched_at ?? '',
        fetchedVia: raw.fetchedVia ?? raw.fetched_via ?? 'server-fetch',
      });
    }
  }
  return details;
}

function buildConceptImagePrompt(c: DiscoverCandidateRow): string {
  const points = safeParseList<string>(c.selling_points);
  return [
    `Studio product concept render of: ${c.product_name}`,
    `Category: ${c.category}`,
    points.length ? `Highlights: ${points.slice(0, 3).join('; ')}` : '',
    'Style: clean white seamless background, soft commercial lighting, centered hero composition, photoreal product render, 4:5 portrait',
    'Constraints: no text overlay, no watermark, no logo, no human, single product only',
  ]
    .filter(Boolean)
    .join('\n');
}

function safeParseList<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

const SYSTEM_PROMPT = `You are a senior cross-border e-commerce sourcing analyst.
Output strict JSON matching the schema. Be conservative — when unsure, lower the score and say so in summary.
All user-facing fields MUST be written in Simplified Chinese, including product_name, category, summary, selling_points, risks, and differentiation. Keep supplier/search URL keywords in English only where the URL template requires it.

Follow the Etsy operations selection SOP from the product playbook:
- Treat this as product selection / product initiation, not generic idea generation.
- Every candidate must be anchored to visible live samples: mention the sample/detail being compared in summary or differentiation.
- The user needs to judge: search demand, moderate competition, brand/differentiation space, target margin >= 30%, and repeat/seasonal potential.
- selling_points should cover concrete SKU definition: target buyer, usage scene, material/spec/packaging/customization suggestion, visual direction, and English listing keyword direction when evidence allows.
- risks should include the validation work before launch: supply/cost, packaging/logistics, platform compliance, custom return rules, or review/pain-point uncertainty.
- differentiation must be readable as: competitor problem -> our concrete change -> why it may sell -> what to validate first. Do not output a vague marketing paragraph.

Scoring rubric (each 0-100, integer):
- score_demand: market demand & search volume signal
- score_competition: 100 = blue ocean, 0 = saturated red ocean (HIGHER = LESS competition)
- score_profit: estimated gross margin potential after platform fees / shipping
- score_compliance: 100 = no regulatory friction (toys / batteries / cosmetics / food are lower)
- score_logistics: 100 = light, durable, standard packaging (large / fragile / hazmat are lower)

You receive live marketplace samples and product-detail evidence in the prompt. Use only that evidence plus conservative general e-commerce reasoning. Do not imply you browsed any page not provided.

For each candidate you MUST provide:
- differentiation: one paragraph identifying which existing competitor pain point you are improving on, and HOW (concrete spec / material / packaging change). NOT generic "better quality".
- reference_urls: 2-4 entries of REAL platform SEARCH URLs that the user can click to verify your candidate exists in market. Use these URL templates:
    Amazon US:        https://www.amazon.com/s?k=<keywords>
    Amazon UK:        https://www.amazon.co.uk/s?k=<keywords>
    Amazon JP:        https://www.amazon.co.jp/s?k=<keywords>
    Amazon DE:        https://www.amazon.de/s?k=<keywords>
    TikTok Shop US:   https://shop.tiktok.com/view/search?q=<keywords>
    Etsy:             https://www.etsy.com/search?q=<keywords>
    Shopee SG:        https://shopee.sg/search?keyword=<keywords>
    Lazada SG:        https://www.lazada.sg/catalog/?q=<keywords>
    Walmart:          https://www.walmart.com/search?q=<keywords>
    Shopify Apps directory or eBay also acceptable.
  Replace <keywords> with the candidate product_name (URL-encoded). Pick platforms that match the user-specified market and platform_focus.
- source_search_urls: 1-3 entries of supplier sourcing SEARCH URLs. Use:
    1688:        https://s.1688.com/selloffer/offer_search.htm?keywords=<keywords>
    Alibaba:     https://www.alibaba.com/trade/search?SearchText=<keywords>
    AliExpress:  https://www.aliexpress.com/wholesale?SearchText=<keywords>
  URL-encode keywords in English (use the english product name).

NEVER fabricate a fake product detail URL (no /dp/ASIN, no /itm/ID). ONLY use the search URL templates above.`;

interface BuildPromptArgs {
  keyword: string;
  market: string;
  priceBand?: string | null;
  platformFocus?: string[];
  strategy?: string | null;
  count?: number;
  hotSellingOnly?: boolean;
}

function buildPrompt(
  args: BuildPromptArgs,
  liveSamples: FetchSamplesResult[],
  strategyRule: SelectionStrategyRule,
): string {
  const count = args.count ?? 8;
  const platforms = args.platformFocus?.length
    ? `Target platforms: ${args.platformFocus.join(', ')}`
    : '';
  const strategy = `Sourcing strategy: ${strategyRule.label} (${strategyRule.id}). ${strategyRule.promptRule}
Score-total weights applied after generation: demand=${strategyRule.weights.demand}, competition=${strategyRule.weights.competition}, profit=${strategyRule.weights.profit}, compliance=${strategyRule.weights.compliance}, logistics=${strategyRule.weights.logistics}.`;
  const price = args.priceBand ? `Target retail price band: ${args.priceBand}` : '';
  const hotSellingMode = args.hotSellingOnly
    ? [
        'Hot-selling preference: ON.',
        'Prioritize product candidates anchored to samples with high heat_score / strong Etsy public heat signals.',
        'Do not invent sales numbers. Treat heat_score as a public-signal score, not true unit sales.',
      ].join('\n')
    : '';

  const samplesBlock = renderLiveSamplesForPrompt(liveSamples);

  return [
    `Suggest ${count} concrete cross-border e-commerce product candidates.`,
    `Niche keyword: ${args.keyword}`,
    `Target market: ${args.market}`,
    platforms,
    strategy,
    price,
    hotSellingMode,
    '',
    samplesBlock,
    '',
    'Each candidate must be a CONCRETE sellable SKU concept (not a category name like "kitchen tools").',
    'Diversify: include some safe-bet picks and some opportunistic blue-ocean picks.',
    'Use the LIVE MARKET SAMPLES and LIVE PRODUCT DETAILS above as your PRIMARY evidence. Calibrate scores against them: if 4 of 5 samples are saturated big brands, lower competition score; if average price is $X, your estimated_price_usd should be near $X. In each candidate\'s summary, cite at least one sample or detail title you are differentiating against (e.g. "vs the Hydro Flask in sample #2, this candidate adds…"). DO NOT invent candidate names that have no relationship to any visible sample/detail.',
    'For each: Chinese product_name (concrete, evidence-anchored), Chinese category, estimated_price_usd if confident, 5 scores, 1-2 sentence Chinese summary (must cite a sample/detail), 4-6 Chinese selling points covering target buyer / usage scene / spec or packaging / visual direction / English listing keywords, 3-4 Chinese risks covering cost / supply / compliance / comment-pain-point uncertainty, Chinese differentiation paragraph in the structure "竞品问题 -> 我们方案 -> 为什么可能卖 -> 先验证", reference_urls (2-4 platform search URLs), source_search_urls (1-3 supplier search URLs).',
  ]
    .filter(Boolean)
    .join('\n');
}

function resolveDiscoverSampleCount(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value)
    ? Math.floor(value)
    : DEFAULT_DISCOVER_SAMPLE_COUNT;
  return Math.min(Math.max(n, 3), MAX_DISCOVER_SAMPLE_COUNT);
}

async function fetchSamplesForResearch(
  store: AppDataStore,
  input: ResearchInput,
  abortSignal?: AbortSignal,
): Promise<FetchSamplesResult[]> {
  const platforms = (input.platformFocus && input.platformFocus.length > 0)
    ? input.platformFocus
    : ['amazon-us'];
  const targets = platforms
    .slice(0, 2)
    .map((p) => buildPlatformSearchUrl(p, input.keyword))
    .filter((x): x is NonNullable<typeof x> => x != null);
  if (targets.length === 0) return [];
  const sampleCount = resolveDiscoverSampleCount(input.sampleCount);
  return Promise.all(
    targets.map((t) =>
      fetchSearchSamples({
        source: t.source,
        url: t.url,
        acceptLanguage: t.acceptLanguage,
        abortSignal,
        maxSamples: sampleCount,
        store,
      }),
    ),
  );
}

function renderLiveSamplesForPrompt(results: FetchSamplesResult[]): string {
  const usable = results.filter((r) => r.samples.length > 0);
  if (usable.length === 0) return '';
  const blocks = usable.map((r) => {
    const sampleLines = r.samples.map(
      (s, i) =>
        `  S${i + 1}. ${s.title}${s.price ? ` · ${s.price}` : ''}${
          s.rating ? ` · ★${s.rating}` : ''
        }${s.reviews ? ` (${s.reviews})` : ''}${s.sales ? ` · sales: ${s.sales}` : ''}${
          s.badges?.length ? ` · badges: ${s.badges.join(' / ')}` : ''
        }${s.heatScore != null ? ` · heat_score: ${s.heatScore} (${s.heatLevel ?? 'unknown'}, confidence ${s.heatConfidence ?? 'unknown'})` : ''}${
          s.heatReasons?.length ? ` · heat_reasons: ${s.heatReasons.join(' / ')}` : ''
        }${s.url ? ` · ${s.url}` : ''}`,
    );
    const detailLines = (r.details ?? []).map((d) => {
      const bullets = d.bulletPoints.length ? ` · bullets: ${d.bulletPoints.slice(0, 3).join(' / ')}` : '';
      return `  D${d.rank}. ${d.title}${d.price ? ` · ${d.price}` : ''}${
        d.rating ? ` · ★${d.rating}` : ''
      }${d.reviews ? ` (${d.reviews})` : ''}${d.sales ? ` · sales: ${d.sales}` : ''}${
        d.badges?.length ? ` · badges: ${d.badges.join(' / ')}` : ''
      }${d.brand ? ` · brand: ${d.brand}` : ''}${bullets} · ${d.url}`;
    });
    return [
      `Live samples from ${r.source} (fetched ${r.fetchedAt}, ${r.fetchedVia ?? 'unknown'}):`,
      ...sampleLines,
      detailLines.length ? `Live product details from ${r.source}:` : '',
      ...detailLines,
      r.detailWarnings?.length ? `Detail warnings: ${r.detailWarnings.join('；')}` : '',
    ].filter(Boolean).join('\n');
  });
  return ['LIVE MARKET SAMPLES (fetched from user IP, real data):', '', ...blocks].join('\n');
}

function buildSourcesEntry(
  liveSamples: FetchSamplesResult[],
  strategy: SelectionStrategyRule,
  input?: Pick<ResearchInput, 'hotSellingOnly' | 'sampleCount'>,
): unknown[] {
  const entries: unknown[] = [];
  entries.push({
    kind: 'research-preferences',
    hot_selling_only: Boolean(input?.hotSellingOnly),
    sample_count: resolveDiscoverSampleCount(input?.sampleCount),
  });
  for (const r of liveSamples) {
    if (r.samples.length > 0) {
      entries.push({
        kind: 'live-fetch',
        source: r.source,
        url: r.url,
        sample_count: r.samples.length,
        samples: r.samples.map((s: MarketSample) => ({
          title: s.title,
          product_id: s.productId ?? null,
          price: s.price ?? null,
          rating: s.rating ?? null,
          reviews: s.reviews ?? null,
          sales: s.sales ?? null,
          brand: s.brand ?? null,
          category: s.category ?? null,
          url: s.url ?? null,
          image_url: s.imageUrl ?? null,
          image_urls: s.imageUrls ?? [],
          keyword_tags: s.keywordTags ?? [],
          badges: s.badges ?? [],
          sponsored: s.sponsored ?? false,
          heat_score: s.heatScore ?? null,
          heat_level: s.heatLevel ?? null,
          heat_confidence: s.heatConfidence ?? null,
          heat_reasons: s.heatReasons ?? [],
        })),
        details: (r.details ?? []).map((d) => ({
          rank: d.rank,
          title: d.title,
          url: d.url,
          product_id: d.productId ?? null,
          price: d.price ?? null,
          rating: d.rating ?? null,
          reviews: d.reviews ?? null,
          sales: d.sales ?? null,
          brand: d.brand ?? null,
          category: d.category ?? null,
          availability: d.availability ?? null,
          bullet_points: d.bulletPoints,
          description: d.description ?? null,
          image_url: d.imageUrl ?? null,
          gallery_image_urls: d.galleryImageUrls ?? [],
          review_snippets: d.reviewSnippets ?? [],
          badges: d.badges ?? [],
          fetched_via: d.fetchedVia,
          fetched_at: d.fetchedAt,
        })),
        detail_warnings: r.detailWarnings ?? [],
        fetched_at: r.fetchedAt,
        fetched_via: r.fetchedVia ?? null,
      });
    } else {
      entries.push({
        kind: 'live-fetch-failed',
        source: r.source,
        url: r.url,
        reason: r.warning,
        fetched_at: r.fetchedAt,
      });
    }
  }
  entries.push({
    kind: 'selection-strategy',
    id: strategy.id,
    label: strategy.label,
    weights: strategy.weights,
    rule: strategy.promptRule,
  });
  return entries;
}
