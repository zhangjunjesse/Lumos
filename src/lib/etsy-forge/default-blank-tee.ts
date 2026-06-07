// 默认空白 T 底图:ad-hoc「图/URL → 产品」统一用的空白 T,保证这类产品的 T 恤一致(锁色合成需要一件空白 T)。
// 存成一条带标记的 'product' 素材(category='product'、description=MARKER、无 product_id)。首次自动文生图一件标准黑 T,之后复用。
// 设置里换/上传是另一处(只要把这条标记素材替换即可)。不 mock:生成失败如实返回 error。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { generateImagesWithRetry } from './image-gen-retry';
import { COLLECTIONS, type AssetRow } from './types';

export const DEFAULT_BLANK_TEE_MARKER = '默认空白T(ad-hoc 图→产品)';
const GEN_TIMEOUT_MS = 600_000;
const BLANK_TEE_PROMPT =
  'A plain solid black t-shirt, flat lay, front view, centered on a clean neutral light-gray background. Completely BLANK — no print, no graphic, no logo, no text of any kind. An empty t-shirt product mockup template ready for a chest print.';

// 找已有的默认空白 T(无则不创建)。
export function findDefaultBlankTee(store: AppDataStore, userId: string): AssetRow | null {
  return (
    store
      .query<AssetRow>(COLLECTIONS.ASSETS, { filter: { user_id: userId, category: 'product', status: 'success' }, limit: 500 })
      .find((a) => a.description === DEFAULT_BLANK_TEE_MARKER && typeof a.image_path === 'string' && a.image_path) ?? null
  );
}

// 取默认空白 T 素材;没有就文生图一件并落库。返回素材 id(给锁色合成用)或 error。
export async function getOrCreateDefaultBlankTee(store: AppDataStore, userId: string): Promise<{ assetId: string } | { error: string }> {
  const existing = findDefaultBlankTee(store, userId);
  if (existing) return { assetId: existing.id };

  if (!resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false })) {
    return { error: '未配置图片服务商,无法生成默认空白 T。去「设置 → 图片生成」选一个。' };
  }
  try {
    const res = await generateImagesWithRetry({ prompt: BLANK_TEE_PROMPT, abortSignal: AbortSignal.timeout(GEN_TIMEOUT_MS) }, 3, '默认空白T', {});
    const out = res.images[0];
    if (!out?.localPath) return { error: '生成默认空白 T 失败:服务商未返回图' };
    const asset = store.create(COLLECTIONS.ASSETS, {
      user_id: userId,
      category: 'product',
      description: DEFAULT_BLANK_TEE_MARKER,
      source_image_ids: [],
      image_path: out.localPath,
      status: 'success',
      created_at: new Date().toISOString(),
    });
    return { assetId: asset.id as string };
  } catch (err) {
    return { error: `生成默认空白 T 失败:${err instanceof Error ? err.message : String(err)}` };
  }
}
