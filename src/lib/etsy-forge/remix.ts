// ⑤ 自动二创(两段式):A 先 vision 拆解参考印花出设计简报 → B 按 5 条受控变体轴各出 1 张原创印花。
// 每张 = 简报 + 一条变体轴 + 印花质量约束(只出图案/透明底/限色/单焦点/无文字),原印花作 image-to-image 锚定风格。
// 存 assets(category=remix),重跑覆盖。走「设置→图片生成」服务商;有限并发。不 mock:拆解失败降级用标题、生成失败如实记。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEffectivePrompt } from './prompt-defaults';
import { generateImagesWithRetry } from './image-gen-retry';
import { getImageConcurrency, mapLimit } from './concurrency';
import { loadImageAsBase64, type FetchedImage } from './image-fetch';
import { analyzeForRemix, type RemixBrief, type RemixDirection } from './remix-analyze';
import { judgeRemix } from './remix-qa';
import { resolveVisionEndpoint } from './vision-provider';
import { REMIX_AXES, TEXT_RULE_GRAPHIC, TEXT_RULE_TEXT, TEXT_RULE_COMBO, buildIpRule } from './remix-axes';
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

// 用量身方向,不足 n 条用固定变体轴补齐(降级兜底)。
function buildDirections(given: RemixDirection[], n: number): RemixDirection[] {
  const out = given.slice(0, n);
  for (let i = out.length; i < n; i++) {
    const ax = REMIX_AXES[i % REMIX_AXES.length];
    out.push({ text: ax.instruction, useReference: ax.useReference });
  }
  return out;
}

export async function runRemix(
  store: AppDataStore,
  input: { userId: string; productId: string; count?: number },
): Promise<RunRemixResult> {
  const product = store.get<ProductRow>(COLLECTIONS.PRODUCTS, input.productId);
  if (!product || product.user_id !== input.userId) return { ok: false, created: 0, failed: 0, error: '商品不存在' };

  const provider = resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false });
  if (!provider) return { ok: false, created: 0, failed: 0, error: '未配置图片服务商。去「设置 → 图片生成」选一个支持图像编辑的服务商。' };
  // 识图(拆解 + 质检)走「设置→识图服务商」指定的服务商/模型,没指定回退图片服务商 + gemini。
  const vision = resolveVisionEndpoint(store);

  const cutout = store.query<CutoutRow>(COLLECTIONS.CUTOUTS, {
    filter: { product_id: input.productId, status: 'success' },
    orderBy: { field: 'created_at', direction: 'desc' },
    limit: 1,
  })[0];
  if (!cutout?.cutout_path) return { ok: false, created: 0, failed: 0, error: '该商品还没有抠出的印花,先抠印花再二创' };
  const cutoutPath = cutout.cutout_path; // 捕获,避免闭包里丢类型收窄

  let designImg: FetchedImage;
  try {
    designImg = await loadImageAsBase64({ localPath: cutout.cutout_path, url: `/api/media/serve?path=${encodeURIComponent(cutout.cutout_path)}` });
  } catch (err) {
    return { ok: false, created: 0, failed: 0, error: `读取印花失败:${err instanceof Error ? err.message : String(err)}` };
  }

  // A 拆解:vision 出 JSON(类型 + 简报 + 量身方向);失败不阻断,降级成标题简报 + 固定轴(如实记日志,不假装)。
  let analysis: RemixBrief;
  try {
    if (!vision.ok) throw new Error(vision.error);
    analysis = await analyzeForRemix(vision.ep, designImg, getEffectivePrompt(store, input.userId, 'remix-analyze'));
  } catch (err) {
    logEvent('二创拆解', 'warn', `商品 ${input.productId} 拆解失败,降级用标题+固定轴:${err instanceof Error ? err.message : String(err)}`);
    analysis = { type: 'graphic', layout: 'single-hero', ipRisk: '', brief: `SUBJECT: based on product title "${product.title || '(none)'}"\nSTYLE: match the reference image`, directions: [] };
  }
  const points = sellingPoints(product.review_analysis);
  const fullBrief = points ? `${analysis.brief}\nBUYER SELLING-POINTS: ${points}` : analysis.brief;
  const textRule = analysis.type === 'text' ? TEXT_RULE_TEXT : analysis.type === 'combo' ? TEXT_RULE_COMBO : TEXT_RULE_GRAPHIC;
  const ipRule = buildIpRule(analysis.ipRisk);
  const template = getEffectivePrompt(store, input.userId, 'remix-variant');

  // 重跑覆盖:删该商品旧 remix 素材
  const old = store.query<AssetRow>(COLLECTIONS.ASSETS, { filter: { user_id: input.userId, product_id: input.productId, category: 'remix' }, limit: 100 });
  for (const o of old) store.delete(COLLECTIONS.ASSETS, o.id);

  // B 变体:每条方向出 1 张(改一处),原印花作宽松风格参考。方向用拆解的量身建议,不足用固定轴补齐。
  const n = Math.max(1, Math.min(VARIANT_COUNT, input.count ?? VARIANT_COUNT));
  const directions = buildDirections(analysis.directions, n);
  const outcomes = await mapLimit(directions, getImageConcurrency(store), async (direction, i) => {
    const now = new Date().toISOString();
    const label = `二创#${i + 1}:${direction.text.slice(0, 20)}`;
    const prompt = template
      .replace('{brief}', fullBrief)
      .replace('{title}', product.title || '(none)')
      .replace('{direction}', direction.text)
      .replace('{textRule}', textRule)
      .replace('{ipRule}', ipRule);
    // 贴近原图的方向喂参考图辅助;发散的方向不喂(纯文字生成,更原创、差异更大)。
    const referenceImages = direction.useReference ? [designImg] : undefined;
    try {
      const res = await generateImagesWithRetry(
        { prompt, referenceImages, abortSignal: AbortSignal.timeout(REMIX_TIMEOUT_MS) },
        3,
        label,
        { product: product.title || input.productId, sources: referenceImages ? [`/api/media/serve?path=${encodeURIComponent(cutoutPath)}`] : [] },
      );
      const out = res.images[0];
      if (!out?.localPath) throw new Error('图片服务商未返回二创结果');
      // 质量闸门:载入成品跑 vision 质检(白底框/多余文字/糊…),good/weak 落库供 UI 标记。识图端点没配则跳过质检。
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
