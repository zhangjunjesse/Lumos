import { createHash } from 'node:crypto';
import { z } from 'zod';

import { EcommerceLlmUnavailableError, generateStructured } from '../llm-client';
import type { EtsyReviewBundle, ReviewIntel } from './types';

/**
 * 评论分析 —— 用 Lumos 自有 LLM 复刻 EHunt 的 AI Review Analysis。
 *
 * 边界（见 docs/ecommerce-ehunt-review-intel-guide.md §5.3）：
 * - 纯函数，不耦合存储（与 research-analyze.ts 一致）；持久化由调用方在集成层绑定。
 * - LLM 不可用 → 返回 null 走降级（不编造）；真实 LLM 错误抛出，交由路由记失败。
 * - 默认不触发：触发时机（用户手动）是 UI/路由职责，不在本层。
 * - 缓存：key = listingId + 评论内容 hash；评论未变命中缓存，不重复调 LLM。
 */

const PROMPT_REVIEW_CAP = 120;
const PROMPT_TEXT_CAP = 600;
const ANALYSIS_MODEL_TAG = 'lumos-ecommerce-review-analysis';

const reviewIntelSchema = z.object({
  customer_profile: z.object({
    gender_split: z.string().max(80).optional(),
    who: z.array(z.string().max(120)).max(8).default([]),
    when: z.array(z.string().max(120)).max(8).default([]),
    where: z.array(z.string().max(120)).max(8).default([]),
    what: z.array(z.string().max(120)).max(8).default([]),
  }),
  pros: z.array(z.object({ topic: z.string().max(80), reason: z.string().max(300) })).max(12).default([]),
  cons: z.array(z.object({ topic: z.string().max(80), reason: z.string().max(300) })).max(12).default([]),
  expectations: z.array(z.object({ topic: z.string().max(80), reason: z.string().max(300) })).max(12).default([]),
  motivations: z.array(z.object({ topic: z.string().max(80), reason: z.string().max(300) })).max(12).default([]),
});

type ReviewIntelRaw = z.infer<typeof reviewIntelSchema>;

/** 可注入的缓存接口；持久化实现（AppDataStore 等）由集成层提供，保持本层纯净可测。 */
export interface ReviewIntelCache {
  get(listingId: string, reviewHash: string): Promise<ReviewIntel | null> | ReviewIntel | null;
  put(intel: ReviewIntel & { listingId: string }): Promise<void> | void;
}

/** 评论内容稳定 hash：listingId + 每条 (rating|text)。评论不变则 hash 不变 → 命中缓存。 */
export function computeReviewHash(bundle: EtsyReviewBundle): string {
  const h = createHash('sha256');
  h.update(bundle.listingId);
  for (const r of bundle.reviews) {
    h.update(`\n${r.rating ?? ''}|${r.text}`);
  }
  return h.digest('hex').slice(0, 32);
}

function buildPrompt(bundle: EtsyReviewBundle): string {
  const reviews = bundle.reviews.slice(0, PROMPT_REVIEW_CAP).map((r) => ({
    rating: r.rating,
    date: r.date,
    variations: r.variations,
    text: r.text.slice(0, PROMPT_TEXT_CAP),
  }));
  return [
    `listing: ${bundle.listingId}`,
    `总评论数: ${bundle.totalReviews}，平均分: ${bundle.averageRating ?? 'N/A'}`,
    `评分分布: ${JSON.stringify(bundle.ratingCounts)}`,
    `Etsy 标签情感(先验): ${JSON.stringify(bundle.tagFilters)}`,
    '',
    '【原始评论（JSON，已截断）】',
    JSON.stringify(reviews),
    '',
    '请基于以上评论与先验，输出 schema 要求的字段：',
    '- customer_profile.gender_split: 如能从评论/收礼描述推断买家或收礼人性别倾向则给"male X% / female Y%"，否则留空；',
    '- who/when/where/what: 各 3-6 条短语（人群 / 时节 / 地域 / 用途），附占比时直接写在短语里；',
    '- pros/cons/expectations/motivations: 各 3-8 组 {topic, reason}，reason 必须归因到具体评论现象。',
  ].join('\n');
}

function toIntel(raw: ReviewIntelRaw, reviewHash: string): ReviewIntel {
  return {
    customerProfile: {
      genderSplit: raw.customer_profile.gender_split ?? null,
      who: raw.customer_profile.who,
      when: raw.customer_profile.when,
      where: raw.customer_profile.where,
      what: raw.customer_profile.what,
    },
    pros: raw.pros,
    cons: raw.cons,
    expectations: raw.expectations,
    motivations: raw.motivations,
    model: ANALYSIS_MODEL_TAG,
    analyzedAt: new Date().toISOString(),
    reviewHash,
  };
}

const SYSTEM = [
  '你是 Lumos 电商助手内置的"评论情报分析师"，目标是把一个 Etsy listing 的真实买家评论提炼成与 EHunt AI Review Analysis 同等结构的洞察。',
  '严格遵循输出 schema；只能基于给定评论与先验归因，禁止编造评论中没有出现的事实；样本过少时在对应字段明确写"样本不足"，不要凑数。',
].join('\n');

/**
 * 分析一个 listing 的评论。返回 null 表示 LLM 不可用（调用方降级显示"未配置可用模型"），
 * 评论为空也返回 null（调用方提示先采集）。真实 LLM 错误向上抛。
 */
export async function analyzeReviews(
  bundle: EtsyReviewBundle,
  opts: { signal?: AbortSignal; cache?: ReviewIntelCache } = {},
): Promise<ReviewIntel | null> {
  if (bundle.status !== 'ok' || bundle.reviews.length === 0) {
    return null;
  }
  const reviewHash = computeReviewHash(bundle);
  if (opts.cache) {
    const cached = await opts.cache.get(bundle.listingId, reviewHash);
    if (cached) return cached;
  }

  let raw: ReviewIntelRaw;
  try {
    raw = await generateStructured<ReviewIntelRaw>({
      system: SYSTEM,
      prompt: buildPrompt(bundle),
      schema: reviewIntelSchema,
      maxTokens: 2048,
      abortSignal: opts.signal,
    });
  } catch (err) {
    if (err instanceof EcommerceLlmUnavailableError) {
      return null;
    }
    throw err;
  }

  const intel = toIntel(raw, reviewHash);
  if (opts.cache) {
    await opts.cache.put({ ...intel, listingId: bundle.listingId });
  }
  return intel;
}
