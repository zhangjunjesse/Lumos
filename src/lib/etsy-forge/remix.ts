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
  buildIpRule,
  type RemixDirection,
  type RemixDirectionKey,
} from './remix-axes';
import { logEvent } from './log';
import { COLLECTIONS, type AssetRow, type CutoutRow, type ProductRow, type ReviewAnalysis } from './types';

const REMIX_TIMEOUT_MS = 600_000;
const VARIANT_COUNT = 5;

export interface RunRemixResult {
  ok: boolean;
  created: number;
  failed: number;
  error?: string;
}

function sellingPoints(analysis?: ReviewAnalysis): string {
  if (!analysis) return '';
  return [...(analysis.pros ?? []), ...(analysis.motivations ?? [])]
    .map((t) => t.topic)
    .filter(Boolean)
    .slice(0, 8)
    .join(', ');
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
  parts: { brief: string; title: string; dir: RemixDirection; hook: string; niche: string; palette: string; textRule: string; ipRule: string },
): string {
  return template
    .replace('{brief}', parts.brief)
    .replace('{title}', parts.title || '(none)')
    .replace('{direction}', parts.dir.profile)
    .replace('{hook}', parts.hook)
    .replace('{niche}', parts.niche)
    .replace('{palette}', parts.palette)
    .replace('{textRule}', parts.textRule)
    .replace('{ipRule}', parts.ipRule);
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

  // A 拆解:vision 出结构化分析;失败不阻断,降级成标题简报(如实记日志,不假装)。
  let analysis: RemixAnalysis;
  try {
    if (!vision.ok) throw new Error(vision.error);
    analysis = await analyzeForRemix(vision.ep, designImg, getEffectivePrompt(store, input.userId, 'remix-analyze'));
    logEvent('二创拆解', 'info', `商品 ${product.title || input.productId} 拆解完成:${analysis.niches.length} niche · ${analysis.hooks.length} 钩子 · ${analysis.palettes.length} 配色${analysis.ipRisk ? ` · 侵权风险:${analysis.ipRisk}` : ''}`, product.title);
  } catch (err) {
    logEvent('二创拆解', 'warn', `商品 ${input.productId} 拆解失败,降级用标题:${err instanceof Error ? err.message : String(err)}`);
    analysis = fallbackAnalysis(product.title || '');
  }

  const points = sellingPoints(product.review_analysis);
  const brief = points ? `${factsBriefText(analysis)}\nBUYER SELLING-POINTS: ${points}` : factsBriefText(analysis);
  const textRule = analysis.type === 'text' ? TEXT_RULE_TEXT : analysis.type === 'combo' ? TEXT_RULE_COMBO : TEXT_RULE_GRAPHIC;
  const ipRule = buildIpRule(analysis.ipRisk);
  const template = getEffectivePrompt(store, input.userId, 'remix-variant');
  const { hooks, niches, palettes } = buildPools(analysis);

  // 重跑覆盖:删该商品旧 remix 素材;但保留系列化(series_of)扩展出来的图,避免重跑二创把系列冲掉。
  const old = store.query<AssetRow>(COLLECTIONS.ASSETS, { filter: { user_id: input.userId, product_id: input.productId, category: 'remix' }, limit: 200 });
  for (const o of old) if (!o.series_of) store.delete(COLLECTIONS.ASSETS, o.id);

  // B 变体:选中方向(默认 B)× 钩子 × niche × 配色 逐张轮转,共 n 张。
  const dirs = (input.directions?.length ? input.directions : (['B'] as RemixDirectionKey[])).map(getDirection);
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
    const prompt = buildVariantPrompt(template, { brief, title: product.title || '', dir, hook, niche, palette, textRule, ipRule });
    // 贴近原图的方向(A/B)喂参考图;发散方向(C/D)纯文字从简报生成,更原创、差异更大。
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
