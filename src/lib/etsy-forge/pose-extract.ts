// 抠模特姿势：从含模特的原图逐张抠出模特本人(去背景、保留真实姿势和身上的衣服，不改衣服)。
// 一张原图 → 一个 pose 素材(AssetRow category='pose')，姿势多样靠用户选多张不同姿势的原图。
// 重抠覆盖该商品旧 pose。走「设置→图片生成」服务商(generateImages 解析 image override，受 media 锁定)。
// 不 mock：服务商没配/没人/失败都如实记 failed + 原因。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEffectivePrompt } from './prompt-defaults';
import { generateImagesWithRetry } from './image-gen-retry';
import { loadImageAsBase64 } from './image-fetch';
import { COLLECTIONS, type AssetRow, type DetailImageRow, type ProductRow } from './types';

const POSE_TIMEOUT_MS = 600_000; // 10min：中转链路长、单张可能慢，给足时间避免本地提前 abort

export interface RunPoseResult {
  ok: boolean;
  created: number;
  failed: number;
  error?: string;
}

export async function runPoseExtract(
  store: AppDataStore,
  input: { userId: string; productId: string; imageIds?: string[] },
): Promise<RunPoseResult> {
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
  if (input.imageIds?.length) {
    const set = new Set(input.imageIds);
    imgs = imgs.filter((i) => set.has(i.id));
  }
  if (imgs.length === 0) {
    return { ok: false, created: 0, failed: 0, error: '没有可用的图（该商品没采详情图，或选中的图不属于它）。' };
  }

  const prompt = getEffectivePrompt(store, input.userId, 'pose');

  // 重抠覆盖：删该商品旧的 pose 素材
  const old = store.query<AssetRow>(COLLECTIONS.ASSETS, {
    filter: { user_id: input.userId, product_id: input.productId, category: 'pose' },
    limit: 500,
  });
  for (const o of old) store.delete(COLLECTIONS.ASSETS, o.id);

  let created = 0;
  let failed = 0;
  for (const img of imgs) {
    const now = new Date().toISOString();
    try {
      const ref = await loadImageAsBase64({ localPath: img.local_path, url: img.image_url });
      const res = await generateImagesWithRetry(
        { prompt, referenceImages: [ref], abortSignal: AbortSignal.timeout(POSE_TIMEOUT_MS) },
        3,
        '抠姿势',
        { product: product.title || input.productId, sources: [img.image_url] },
      );
      const out = res.images[0];
      if (!out?.localPath) throw new Error('图片服务商未返回抠图结果（可能该模型不支持图像编辑）');
      store.create(COLLECTIONS.ASSETS, {
        user_id: input.userId,
        category: 'pose',
        product_id: input.productId,
        source_image_ids: [img.id],
        image_path: out.localPath,
        status: 'success',
        created_at: now,
      });
      created++;
    } catch (err) {
      store.create(COLLECTIONS.ASSETS, {
        user_id: input.userId,
        category: 'pose',
        product_id: input.productId,
        source_image_ids: [img.id],
        status: 'failed',
        failure_reason: err instanceof Error ? err.message : String(err),
        created_at: now,
      });
      failed++;
    }
  }

  return { ok: created > 0, created, failed };
}
