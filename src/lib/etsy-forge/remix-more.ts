// 「继续二创」:在「我的产品」里针对某个原商品,选一张底图 + 写一句要求 → 图生图 → 存成该原商品的新产品图(mockup)。
// 新图归到 source_product_id,出现在它那一行。走「设置→图片生成」服务商;失败如实记。不 mock。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { generateImagesWithRetry } from './image-gen-retry';
import { loadImageAsBase64 } from './image-fetch';
import { COLLECTIONS, type ProductRow } from './types';

const TIMEOUT_MS = 600_000;

export async function runRemixMore(
  store: AppDataStore,
  input: { userId: string; productId: string; baseLocalPath?: string; baseUrl: string; instruction: string },
): Promise<{ ok: boolean; error?: string }> {
  const product = store.get<ProductRow>(COLLECTIONS.PRODUCTS, input.productId);
  if (!product || product.user_id !== input.userId) return { ok: false, error: '商品不存在' };

  const provider = resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false });
  if (!provider) return { ok: false, error: '未配置图片服务商。去「设置 → 图片生成」选一个支持图像编辑的服务商。' };

  const instruction = input.instruction.trim();
  if (!instruction) return { ok: false, error: '请填写你的要求' };

  let baseImg;
  try {
    baseImg = await loadImageAsBase64({ localPath: input.baseLocalPath, url: input.baseUrl });
  } catch (err) {
    return { ok: false, error: `读取底图失败:${err instanceof Error ? err.message : String(err)}` };
  }

  const prompt = [
    'Recreate / edit based on the reference image, following this user instruction precisely:',
    instruction,
    'Keep it a clean, print-ready result; high detail; transparent background if the reference is a standalone print; NO watermark, NO signature.',
  ].join('\n');

  const ref = input.baseLocalPath || input.baseUrl;
  const now = new Date().toISOString();
  try {
    const res = await generateImagesWithRetry(
      { prompt, referenceImages: [baseImg], abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
      3,
      '继续二创',
      { product: product.title || input.productId, sources: [input.baseUrl] },
    );
    const out = res.images[0];
    if (!out?.localPath) throw new Error('图片服务商未返回结果');
    store.create(COLLECTIONS.MOCKUPS, {
      user_id: input.userId,
      source_product_id: input.productId,
      design_label: '继续二创',
      design_ref: ref,
      image_path: out.localPath,
      status: 'success',
      created_at: now,
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.create(COLLECTIONS.MOCKUPS, {
      user_id: input.userId,
      source_product_id: input.productId,
      design_label: '继续二创',
      design_ref: ref,
      status: 'failed',
      failure_reason: msg,
      created_at: now,
    });
    return { ok: false, error: msg };
  }
}
