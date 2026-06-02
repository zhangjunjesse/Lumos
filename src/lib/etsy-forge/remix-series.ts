// Step11 系列化:只有评分达标(quality_flag=good)的二创印花才进入系列化。
// 以母版印花为参考,固定「风格/线条/构图逻辑/配色逻辑/情绪价值/目标受众」,沿不同变化轴(主体/身份/节日/道具/文案/表情/场景)各出 1 张,
// 形成 5-10 张同系列新印花。存 assets(category=remix, series_of=母版id),不被普通二创重跑冲掉。走「设置→图片生成」;失败如实记。不 mock。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { generateImagesWithRetry } from './image-gen-retry';
import { getImageConcurrency, mapLimit } from './concurrency';
import { loadImageAsBase64, type FetchedImage } from './image-fetch';
import { judgeRemix } from './remix-qa';
import { resolveVisionEndpoint } from './vision-provider';
import { logEvent } from './log';
import { COLLECTIONS, type AssetRow, type ProductRow } from './types';

const SERIES_TIMEOUT_MS = 600_000;
const DEFAULT_COUNT = 6;

// 变化轴(playbook Step11「可变化元素」):每张系列图沿一个轴变,固定其余视觉语言。
const VARY_AXES: string[] = [
  'a NEW main subject from the same family / theme (keep the same vibe)',
  'bind it to a different purchasable IDENTITY or profession that still fits the theme',
  'a HOLIDAY / seasonal version of the same concept',
  'swap the key PROP or accessory for a fresh themed one',
  'rewrite the COPY into a different original short slogan with the same tone (or add one if there was none)',
  'a different EXPRESSION / emotional beat of the same character or motif',
  'move it to a different SCENE / context while keeping the subject',
];

function seriesPrompt(axis: string): string {
  return [
    'You are an Etsy print-design series builder. Using the reference image as the FIXED style anchor, create ONE new t-shirt print that clearly belongs to the SAME SERIES — NOT a copy of the reference.',
    'KEEP FIXED (must match the reference): illustration style, line quality, composition logic, color logic / palette family, emotional value and target audience.',
    `VARY THIS for the new design: ${axis}.`,
    'Result: a sibling design a shopper would recognize as the same collection but a distinct, separately sellable product. Do NOT trace or copy the reference exact subject, pose, layout or wording.',
    'Print-ready (hard): ONLY the standalone print artwork — NO t-shirt, NO model, NO scene; transparent background (PNG, pure white only if unavailable); bold readable silhouette; clean crisp edges; sticker / screen-print ready; NO watermark, NO signature.',
  ].join('\n');
}

export interface RunSeriesResult {
  ok: boolean;
  created: number;
  failed: number;
  error?: string;
}

export async function runRemixSeries(
  store: AppDataStore,
  input: { userId: string; productId: string; baseAssetId: string; count?: number },
): Promise<RunSeriesResult> {
  const product = store.get<ProductRow>(COLLECTIONS.PRODUCTS, input.productId);
  if (!product || product.user_id !== input.userId) return { ok: false, created: 0, failed: 0, error: '商品不存在' };

  const base = store.get<AssetRow>(COLLECTIONS.ASSETS, input.baseAssetId);
  if (!base || base.user_id !== input.userId || base.category !== 'remix' || !base.image_path) {
    return { ok: false, created: 0, failed: 0, error: '母版二创印花不存在' };
  }
  // 红线:只有达标(非 weak)的图才进系列化;weak 先迭代 prompt,不扩展。
  if (base.quality_flag === 'weak') return { ok: false, created: 0, failed: 0, error: '该图未达标(质检 weak),请先迭代再系列化' };

  const provider = resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false });
  if (!provider) return { ok: false, created: 0, failed: 0, error: '未配置图片服务商。去「设置 → 图片生成」选一个支持图像编辑的服务商。' };
  const vision = resolveVisionEndpoint(store);

  let baseImg: FetchedImage;
  try {
    baseImg = await loadImageAsBase64({ localPath: base.image_path, url: `/api/media/serve?path=${encodeURIComponent(base.image_path)}` });
  } catch (err) {
    return { ok: false, created: 0, failed: 0, error: `读取母版图失败:${err instanceof Error ? err.message : String(err)}` };
  }

  const n = Math.max(3, Math.min(10, input.count ?? DEFAULT_COUNT));
  const plan = Array.from({ length: n }, (_, i) => ({ axis: VARY_AXES[i % VARY_AXES.length], i }));
  logEvent('二创系列化', 'info', `母版「${base.description || base.id}」扩展 ${n} 张系列`, product.title);

  const outcomes = await mapLimit(plan, getImageConcurrency(store), async ({ axis, i }) => {
    const now = new Date().toISOString();
    const label = `系列·#${i + 1}`;
    try {
      const res = await generateImagesWithRetry(
        { prompt: seriesPrompt(axis), referenceImages: [baseImg], abortSignal: AbortSignal.timeout(SERIES_TIMEOUT_MS) },
        3,
        label,
        { product: product.title || input.productId, sources: [`/api/media/serve?path=${encodeURIComponent(base.image_path!)}`] },
      );
      const out = res.images[0];
      if (!out?.localPath) throw new Error('图片服务商未返回系列结果');
      const qa = vision.ok
        ? await judgeRemix(
            vision.ep,
            await loadImageAsBase64({ localPath: out.localPath, url: `/api/media/serve?path=${encodeURIComponent(out.localPath)}` }),
            'graphic',
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
        series_of: input.baseAssetId,
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
        series_of: input.baseAssetId,
        created_at: now,
      });
      return 'fail' as const;
    }
  });
  const created = outcomes.filter((o) => o === 'ok').length;
  return { ok: created > 0, created, failed: outcomes.length - created };
}
