// AI 评论分析：取某商品评论 → 调文本生成服务商 → 解析结构化结果（英文关键词 + 中文总结）→ 缓存到商品。
// 没配服务商 / 没评论都如实抛错，不伪造。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { getProviderModelOptions } from '@/lib/model-metadata';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { generateTextFromProvider } from '@/lib/text-generator';
import { isChatProviderLocked } from './provider-options';
import { COLLECTIONS, type ProductRow, type ReviewAnalysis, type ReviewRow, type ReviewTopic } from './types';

const SYSTEM =
  '你是资深电商选品分析师。基于给定的 Etsy 商品英文买家评论做结构化分析，帮卖家判断客户画像、卖点和改进点。只输出 JSON，不要任何解释或代码块标记。';
// 控 token / 控时延：评论分析只需代表性样本，进 prompt 的评论封顶 + 单条截断，避免 prompt 过长拖慢生成。
const MAX_REVIEWS_FOR_PROMPT = 80;
const PER_REVIEW_PROMPT_CHARS = 280;
const ANALYZE_TIMEOUT_MS = 180_000;
const ANALYZE_MAX_TOKENS = 2800;

export async function analyzeProductReviews(
  store: AppDataStore,
  userId: string,
  productId: string,
): Promise<ReviewAnalysis> {
  const product = store.get<ProductRow>(COLLECTIONS.PRODUCTS, productId);
  if (!product || product.user_id !== userId) throw new Error('商品不存在');

  const reviews = store.query<ReviewRow>(COLLECTIONS.REVIEWS, {
    filter: { product_id: productId },
    orderBy: { field: 'created_at', direction: 'desc' },
    limit: 5000,
  });
  if (reviews.length === 0) throw new Error('该商品还没抓到评论，先去「商品列表」重爬一次详情。');

  // 评论分析优先用应用设置里指定的服务商/模型（避开慢的全局默认中转）；没指定才 fallback 全局默认。
  const settings = store.query<{ ai_provider_id?: string; ai_model?: string }>(COLLECTIONS.APP_SETTINGS, {
    limit: 1,
  })[0];
  // 锁定模式下用 agent-chat 能力走锁定逻辑（强制 system origin）；非锁定用 text-gen（用户可选任意）。
  const provider = resolveProviderForCapability({
    moduleKey: 'chat',
    capability: isChatProviderLocked() ? 'agent-chat' : 'text-gen',
    preferredProviderId: settings?.ai_provider_id?.trim() || undefined,
  });
  if (!provider) throw new Error('未配置可用的 AI 分析服务商，去「设置」里选一个。');
  if (provider.auth_mode === 'local_auth') {
    throw new Error(`服务商「${provider.name}」是本地登录授权，不能做评论分析。去「设置 → AI 评论分析服务商」选一个 API Key 服务商（如阿里云）。`);
  }
  const model = (settings?.ai_model?.trim() || getProviderModelOptions(provider)[0]?.value?.trim() || '');
  if (!model) throw new Error(`服务商「${provider.name}」没有可用模型，先在「设置」里选模型。`);

  const text = await generateTextFromProvider({
    providerId: provider.id,
    model,
    system: SYSTEM,
    prompt: buildPrompt(
      product.title,
      reviews.filter((r) => String(r.text || '').trim()).slice(0, MAX_REVIEWS_FOR_PROMPT),
    ),
    maxTokens: ANALYZE_MAX_TOKENS,
    temperature: 0.3,
    abortSignal: AbortSignal.timeout(ANALYZE_TIMEOUT_MS),
  });

  const analysis = parseAnalysis(text, reviews.length);
  store.update<ProductRow>(COLLECTIONS.PRODUCTS, productId, {
    review_analysis: analysis,
    review_analyzed_at: new Date().toISOString(),
  });
  return analysis;
}

function buildPrompt(title: string, reviews: ReviewRow[]): string {
  const lines = reviews.map((r, i) => {
    const meta = [r.rating ? `${r.rating}★` : '', r.date ?? ''].filter(Boolean).join(' ');
    return `${i + 1}. ${meta ? `[${meta}] ` : ''}${r.text.replace(/\s+/g, ' ').slice(0, PER_REVIEW_PROMPT_CHARS)}`;
  });
  return [
    `商品标题：${title || '(无)'}`,
    `下面是 ${reviews.length} 条买家评论（英文原文）：`,
    lines.join('\n'),
    '',
    '请严格输出如下 JSON（topic 用简短英文关键词；reason/who/when/where/what 用中文，基于评论证据）：',
    '{',
    '  "customerProfile": { "genderMalePct": <0-100整数>, "genderFemalePct": <0-100整数，与男性加起来=100>, "who": "中文：买家是谁", "when": "中文：什么时候买/用", "where": "中文：用在哪/送给谁", "what": "中文：买来做什么" },',
    '  "pros": [ { "topic": "English keyword", "reason": "中文：为什么是优点，引用评论" } ],',
    '  "cons": [ { "topic": "English keyword", "reason": "中文" } ],',
    '  "expectations": [ { "topic": "English keyword", "reason": "中文：消费者期望" } ],',
    '  "motivations": [ { "topic": "English keyword", "reason": "中文：购买动机" } ]',
    '}',
    '每类给 3-6 条，按评论里出现频率从高到低排。性别占比据称呼/送礼对象/用途线索估计，估不出就 50/50 并在 who 注明。只输出 JSON。',
  ].join('\n');
}

function parseAnalysis(text: string, reviewsAnalyzed: number): ReviewAnalysis {
  const json = extractJson(text);
  if (!json) throw new Error('AI 返回的不是有效 JSON，点「重新分析」重试。');
  const cp = (json.customerProfile && typeof json.customerProfile === 'object'
    ? json.customerProfile
    : {}) as Record<string, unknown>;
  const male = clampPct(cp.genderMalePct);
  let female = clampPct(cp.genderFemalePct);
  if (male + female !== 100) female = Math.max(0, 100 - male);
  return {
    reviewsAnalyzed,
    customerProfile: {
      genderMalePct: male,
      genderFemalePct: female,
      who: str(cp.who),
      when: str(cp.when),
      where: str(cp.where),
      what: str(cp.what),
    },
    pros: topics(json.pros),
    cons: topics(json.cons),
    expectations: topics(json.expectations),
    motivations: topics(json.motivations),
  };
}

function extractJson(text: string): Record<string, unknown> | null {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(t.slice(start, end + 1));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function topics(v: unknown): ReviewTopic[] {
  if (!Array.isArray(v)) return [];
  const out: ReviewTopic[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const topic = str(o.topic).slice(0, 80);
    const reason = str(o.reason).slice(0, 300);
    if (!topic && !reason) continue;
    out.push({ topic, reason });
  }
  return out.slice(0, 8);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function clampPct(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}
