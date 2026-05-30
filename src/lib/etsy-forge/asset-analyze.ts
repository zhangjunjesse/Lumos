// 素材生成编排：选一个商品 → 把它的图作参考,直接用图片服务商生成三类素材(场景/模特/产品)。
//
// 为什么不用文本模型"看图拆描述":锁定环境只能用 GPT,而 GPT 走中转做 vision 实测 60s 超时,
// DeepSeek 文本版又不支持看图。所以改走图→图:Nano banana/GPT-Image 本身能看参考图,
// 直接基于商品图生成三类(避开 vision 超时)。走「设置→图片生成」服务商,受 media 锁定。
// 不 mock:服务商没配/不支持/失败都如实记。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEffectivePrompt } from './prompt-defaults';
import { generateImagesWithRetry } from './image-gen-retry';
import { loadImagesBestEffort } from './image-fetch';
import { COLLECTIONS, type AssetCategory, type DetailImageRow, type ProductRow } from './types';

const GEN_TIMEOUT_MS = 180_000;
const MAX_REF_IMAGES = 2; // 参考图越多请求体越大、越易 fetch failed；2 张够模型理解

export interface RunAnalyzeResult {
  ok: boolean;
  created: number;
  failed: number;
  error?: string;
}

export async function runAnalyzeAssets(
  store: AppDataStore,
  input: { userId: string; productId: string; imageIds?: string[] },
): Promise<RunAnalyzeResult> {
  const product = store.get<ProductRow>(COLLECTIONS.PRODUCTS, input.productId);
  if (!product || product.user_id !== input.userId) return { ok: false, created: 0, failed: 0, error: '商品不存在' };

  // 先确认图片服务商可用（没配/锁定无 system 服务商时立即报错）。
  const provider = resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false });
  if (!provider) {
    return {
      ok: false,
      created: 0,
      failed: 0,
      error: '未配置图片服务商。去 Lumos「设置 → 图片生成」选一个支持图像编辑的服务商（如 Nano banana / GPT-Image）。',
    };
  }

  let imgs = store.query<DetailImageRow>(COLLECTIONS.IMAGES, { filter: { product_id: input.productId }, limit: 50 });
  // 指定了图就只用选中的（连带其商品）；否则用该商品全部图。
  if (input.imageIds?.length) {
    const set = new Set(input.imageIds);
    imgs = imgs.filter((i) => set.has(i.id));
  }
  if (imgs.length === 0) {
    return { ok: false, created: 0, failed: 0, error: '没有可用的图（该商品没采详情图，或选中的图不属于它）。' };
  }

  let refs: { mimeType: string; data: string }[];
  const sourceImgs = imgs.slice(0, MAX_REF_IMAGES);
  const sourceImageIds = sourceImgs.map((im) => im.id);
  try {
    refs = await loadImagesBestEffort(sourceImgs.map((im) => ({ localPath: im.local_path, url: im.image_url })));
  } catch (err) {
    return { ok: false, created: 0, failed: 0, error: `下载商品图失败：${err instanceof Error ? err.message : String(err)}` };
  }

  let created = 0;
  let failed = 0;
  for (const category of ['scene', 'model', 'product'] as AssetCategory[]) {
    const now = new Date().toISOString();
    try {
      const res = await generateImagesWithRetry({
        prompt: getEffectivePrompt(store, input.userId, category),
        referenceImages: refs,
        abortSignal: AbortSignal.timeout(GEN_TIMEOUT_MS),
      });
      const out = res.images[0];
      if (!out?.localPath) throw new Error('图片服务商未返回结果');
      store.create(COLLECTIONS.ASSETS, {
        user_id: input.userId,
        category,
        product_id: input.productId,
        source_image_ids: sourceImageIds,
        image_path: out.localPath,
        status: 'success',
        created_at: now,
      });
      created++;
    } catch (err) {
      store.create(COLLECTIONS.ASSETS, {
        user_id: input.userId,
        category,
        product_id: input.productId,
        status: 'failed',
        failure_reason: err instanceof Error ? err.message : String(err),
        created_at: now,
      });
      failed++;
    }
  }

  return { ok: created > 0, created, failed };
}
