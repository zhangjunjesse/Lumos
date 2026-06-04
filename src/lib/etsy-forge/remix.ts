// ⑤ 二创(对齐 playbook 两段式):A 先 vision 拆解参考印花出结构化分析(事实/语义/niche/钩子/配色/侵权);
// B 按"选中方向矩阵(A/B/C/D,可多选)× 钩子 × niche × 配色"逐张组装变体 prompt 出图,再按 5 维评分质检。
// 方向决定相似度策略 + 是否喂参考图;钩子/niche/配色逐张轮转拉差异。存 assets(category=remix),重跑覆盖。
// 走「设置→图片生成」服务商;有限并发。不 mock:拆解失败降级用标题、生成失败如实记。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEffectivePrompt } from './prompt-defaults';
import { generateImagesWithRetry } from './image-gen-retry';
import { getImageConcurrency, mapLimit } from './concurrency';
import { loadImageAsBase64, type FetchedImage } from './image-fetch';
import {
  analyzeForRemix,
  factsBriefText,
  nicheText,
  hookText,
  paletteText,
  paletteConstraintsText,
  styleRetentionText,
  buildRiskRule,
  stickerConcerns,
  fallbackAnalysis,
  type RemixAnalysis,
} from './remix-analyze';
import { judgeRemix } from './remix-qa';
import { resolveVisionEndpoint } from './vision-provider';
import {
  getDirection,
  HOOK_OPERATORS,
  TEXT_RULE_GRAPHIC,
  TEXT_RULE_TEXT,
  TEXT_RULE_COMBO,
  type RemixDirection,
  type RemixDirectionKey,
} from './remix-axes';
import { buildMarketValidation } from './market-validation';
import { logEvent } from './log';
import { COLLECTIONS, type AssetRow, type CutoutRow, type ProductRow } from './types';

const REMIX_TIMEOUT_MS = 600_000;
const VARIANT_COUNT = 5;

export interface RunRemixResult {
  ok: boolean;
  created: number;
  failed: number;
  error?: string;
}

// 拆解的 niche/hook/palette 数组逐张轮转;为空时给兜底(用算子全集 / 从语义推一个 niche / 保留原配色)。
function buildPools(a: RemixAnalysis) {
  const hooks = a.hooks.length ? a.hooks.map(hookText) : HOOK_OPERATORS.map((h) => h.instruction);
  const fallbackNiche = [
    a.semantics.identity && `BUYER: ${a.semantics.identity}`,
    a.semantics.use_case && `USE CASE: ${a.semantics.use_case}`,
    a.semantics.emotional_value && `EMOTION: ${a.semantics.emotional_value}`,
    a.semantics.theme_category && `VISUAL THEME: ${a.semantics.theme_category}`,
  ].filter(Boolean).join('\n');
  const niches = a.niches.length ? a.niches.map(nicheText) : [fallbackNiche || 'Serve the same buyer and emotional value as the reference.'];
  const palettes = a.palettes.length
    ? a.palettes.map(paletteText)
    : ['Keep a commercial palette and complexity similar to the reference; pick a shirt color that maximizes contrast.'];
  return { hooks, niches, palettes };
}

function buildVariantPrompt(
  template: string,
  parts: { brief: string; title: string; dir: RemixDirection; hook: string; niche: string; palette: string; paletteConstraints: string; styleRetention: string; textRule: string; riskRule: string },
): string {
  // 单遍替换:AI/用户文本里可能含 `$`(replace 字符串形式会把 $& / $1 当特殊),也避免注入值里出现 {token} 被下一遍误替换。
  const map: Record<string, string> = {
    brief: parts.brief,
    title: parts.title || '(none)',
    direction: parts.dir.profile,
    hook: parts.hook,
    niche: parts.niche,
    palette: parts.palette,
    paletteConstraints: parts.paletteConstraints,
    styleRetention: parts.styleRetention,
    textRule: parts.textRule,
    riskRule: parts.riskRule,
  };
  return template.replace(/\{(brief|title|direction|hook|niche|palette|paletteConstraints|styleRetention|textRule|riskRule)\}/g, (_, k: string) => map[k] ?? '');
}

export async function runRemix(
  store: AppDataStore,
  input: { userId: string; productId: string; directions?: RemixDirectionKey[]; count?: number },
): Promise<RunRemixResult> {
  const product = store.get<ProductRow>(COLLECTIONS.PRODUCTS, input.productId);
  if (!product || product.user_id !== input.userId) return { ok: false, created: 0, failed: 0, error: '商品不存在' };

  const provider = resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false });
  if (!provider) return { ok: false, created: 0, failed: 0, error: '未配置图片服务商。去「设置 → 图片生成」选一个支持图像编辑的服务商。' };
  const vision = resolveVisionEndpoint(store); // 识图(拆解+质检)走「设置→识图服务商」,没指定回退图片服务商+gemini

  const cutout = store.query<CutoutRow>(COLLECTIONS.CUTOUTS, {
    filter: { product_id: input.productId, status: 'success' },
    orderBy: { field: 'created_at', direction: 'desc' },
    limit: 1,
  })[0];
  if (!cutout?.cutout_path) return { ok: false, created: 0, failed: 0, error: '该商品还没有抠出的印花,先抠印花再二创' };
  const cutoutPath = cutout.cutout_path;

  let designImg: FetchedImage;
  try {
    designImg = await loadImageAsBase64({ localPath: cutoutPath, url: `/api/media/serve?path=${encodeURIComponent(cutoutPath)}` });
  } catch (err) {
    return { ok: false, created: 0, failed: 0, error: `读取印花失败:${err instanceof Error ? err.message : String(err)}` };
  }

  // Step2.5 市场验证:把这个商品自己的评论分析整理成验证数据,喂进拆解让 niche 在真实买家上收敛(没评论则不喂)。
  const mv = buildMarketValidation(product.review_analysis);

  // A 拆解:vision 出结构化分析;失败不阻断,降级成标题简报(如实记日志,不假装)。
  let analysis: RemixAnalysis;
  try {
    if (!vision.ok) throw new Error(vision.error);
    analysis = await analyzeForRemix(vision.ep, designImg, getEffectivePrompt(store, input.userId, 'remix-analyze'), mv.promptSection || undefined);
    logEvent('二创拆解', 'info', `商品 ${product.title || input.productId} 拆解完成:${analysis.niches.length} niche · ${analysis.hooks.length} 钩子 · ${analysis.palettes.length} 配色${analysis.ipRisk ? ` · 侵权风险:${analysis.ipRisk}` : ''}`, product.title);
    // Step2.5 日志:验证起了多大作用 / 没评论时如实标「未验证」。
    const verifiedCount = analysis.niches.filter((n) => /^\s*y/i.test(n.verified)).length;
    logEvent(
      '二创·市场验证',
      mv.verified ? 'info' : 'warn',
      mv.verified
        ? `用 ${mv.reviewsUsed} 条评论验证:${verifiedCount}/${analysis.niches.length} 个 niche 已验证 · 必须保留:${analysis.facts.keep || '—'}`
        : '无真实评论,niche 基于推断(未验证)',
      product.title,
    );
  } catch (err) {
    logEvent('二创拆解', 'warn', `商品 ${input.productId} 拆解失败,降级用标题:${err instanceof Error ? err.message : String(err)}`);
    analysis = fallbackAnalysis(product.title || '');
  }

  // Step8 贴纸化判定:关键项多为「否」→ 很难贴纸化、大概率不适合做主印花。只警告、不跳过(照常出图)。
  const concerns = stickerConcerns(analysis);
  if (concerns.length >= 2) {
    logEvent('二创拆解', 'warn', `贴纸化存疑(${concerns.join('/')}),这张可能不适合做主印花,仍照常生成`, product.title);
  }

  // 必须保留的卖点已由市场验证喂进拆解、落到 facts.keep,brief 自然带出,无需再单独拼 selling-points。
  const brief = factsBriefText(analysis);
  const textRule = analysis.type === 'text' ? TEXT_RULE_TEXT : analysis.type === 'combo' ? TEXT_RULE_COMBO : TEXT_RULE_GRAPHIC;
  const riskRule = buildRiskRule(analysis); // Step6 风险约束(含 IP 剔除)
  const template = getEffectivePrompt(store, input.userId, 'remix-variant');
  const styleRetain = styleRetentionText(analysis); // Step4 风格保留目标(只在贴近原图的 A/B 方向注入)
  const paletteConstraints = paletteConstraintsText(analysis); // Step7 配色约束(所有 variant 共用)
  const { hooks, niches, palettes } = buildPools(analysis);

  // 重跑覆盖:删该商品旧 remix 素材;但保留系列化(series_of)扩展出来的图,避免重跑二创把系列冲掉。
  const old = store.query<AssetRow>(COLLECTIONS.ASSETS, { filter: { user_id: input.userId, product_id: input.productId, category: 'remix' }, limit: 200 });
  for (const o of old) if (!o.series_of) store.delete(COLLECTIONS.ASSETS, o.id);

  // B 变体:选中方向(默认 B)× 钩子 × niche × 配色 逐张轮转,共 n 张。
  // playbook 红线:非自有图不做高相似复刻 → 去掉高相似的 A 方向(若只剩空则退回 B)。
  let dirKeys = input.directions?.length ? input.directions : (['B'] as RemixDirectionKey[]);
  if (analysis.ownership === 'not-owned' && dirKeys.includes('A')) {
    const filtered = dirKeys.filter((k) => k !== 'A');
    dirKeys = filtered.length ? filtered : (['B'] as RemixDirectionKey[]);
    logEvent('二创', 'warn', `非自有图不做高相似复刻,已跳过 A 方向(${product.title || input.productId})`, product.title);
  }
  const dirs = dirKeys.map(getDirection);
  const n = Math.max(1, Math.min(12, input.count ?? VARIANT_COUNT));
  const plan = Array.from({ length: n }, (_, i) => ({
    dir: dirs[i % dirs.length],
    hook: hooks[i % hooks.length],
    niche: niches[i % niches.length],
    palette: palettes[i % palettes.length],
  }));

  const outcomes = await mapLimit(plan, getImageConcurrency(store), async ({ dir, hook, niche, palette }, i) => {
    const now = new Date().toISOString();
    const label = `二创·${dir.label}·#${i + 1}`;
    // 贴近原图的方向(A/B)喂参考图、并注入风格保留目标;发散方向(C/D)换风格,不注入保留词。
    const styleRetention = dir.useReference ? styleRetain : '';
    const prompt = buildVariantPrompt(template, { brief, title: product.title || '', dir, hook, niche, palette, paletteConstraints, styleRetention, textRule, riskRule });
    const referenceImages = dir.useReference ? [designImg] : undefined;
    try {
      const res = await generateImagesWithRetry(
        { prompt, referenceImages, abortSignal: AbortSignal.timeout(REMIX_TIMEOUT_MS) },
        3,
        label,
        { product: product.title || input.productId, sources: referenceImages ? [`/api/media/serve?path=${encodeURIComponent(cutoutPath)}`] : [] },
      );
      const out = res.images[0];
      if (!out?.localPath) throw new Error('图片服务商未返回二创结果');
      const qa = vision.ok
        ? await judgeRemix(
            vision.ep,
            await loadImageAsBase64({ localPath: out.localPath, url: `/api/media/serve?path=${encodeURIComponent(out.localPath)}` }),
            analysis.type,
          ).catch(() => ({ flag: 'good' as const, note: '' }))
        : { flag: 'good' as const, note: '' };
      store.create(COLLECTIONS.ASSETS, {
        user_id: input.userId,
        category: 'remix',
        product_id: input.productId,
        description: label,
        source_image_ids: [],
        image_path: out.localPath,
        status: 'success',
        quality_flag: qa.flag,
        quality_note: qa.note,
        created_at: now,
      });
      return 'ok' as const;
    } catch (err) {
      store.create(COLLECTIONS.ASSETS, {
        user_id: input.userId,
        category: 'remix',
        product_id: input.productId,
        description: label,
        status: 'failed',
        failure_reason: err instanceof Error ? err.message : String(err),
        created_at: now,
      });
      return 'fail' as const;
    }
  });
  const created = outcomes.filter((o) => o === 'ok').length;
  return { ok: created > 0, created, failed: outcomes.length - created };
}
