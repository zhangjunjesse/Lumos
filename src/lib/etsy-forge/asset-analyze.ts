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
import { getImageConcurrency, mapLimit } from './concurrency';
import { COLLECTIONS, type AssetRow, type DetailImageRow, type ProductRow } from './types';

const GEN_TIMEOUT_MS = 600_000; // 10min：中转链路长、单张可能慢，给足时间避免本地提前 abort
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

  // 场景/模特/产品图互相独立,并发出(受「图片生成并发度」约束),不必一张接一张串行。
  const outcomes = await mapLimit(['scene', 'model', 'product'] as const, getImageConcurrency(store), async (category) => {
    const now = new Date().toISOString();
    try {
      const res = await generateImagesWithRetry(
        {
          prompt: getEffectivePrompt(store, input.userId, category),
          referenceImages: refs,
          abortSignal: AbortSignal.timeout(GEN_TIMEOUT_MS),
        },
        3,
        `分析素材(${category})`,
        { product: product.title || input.productId, sources: sourceImgs.map((im) => im.image_url) },
      );
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
      return 'ok' as const;
    } catch (err) {
      store.create(COLLECTIONS.ASSETS, {
        user_id: input.userId,
        category,
        product_id: input.productId,
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

// 单张素材重试：用它原来的来源图 + 该类生效 prompt 重新生成，删旧记录、写新结果。
// 通用覆盖 scene/model/product(综合生成) 和 pose(逐图抠) —— 都是「来源图 + 该类 prompt → 图」。
export async function retryAsset(
  store: AppDataStore,
  input: { userId: string; assetId: string },
): Promise<{ ok: boolean; error?: string }> {
  const asset = store.get<AssetRow>(COLLECTIONS.ASSETS, input.assetId);
  if (!asset || asset.user_id !== input.userId) return { ok: false, error: '素材不存在' };

  const provider = resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false });
  if (!provider) return { ok: false, error: '未配置图片服务商。去 Lumos「设置 → 图片生成」选一个支持图像编辑的服务商。' };

  const ids = Array.isArray(asset.source_image_ids) ? asset.source_image_ids : [];
  if (ids.length === 0) return { ok: false, error: '缺来源图，无法重试' };
  const imgs = ids
    .map((id) => store.get<DetailImageRow>(COLLECTIONS.IMAGES, id))
    .filter((x): x is DetailImageRow => !!x);
  if (imgs.length === 0) return { ok: false, error: '来源图已删，无法重试' };

  let refs: { mimeType: string; data: string }[];
  try {
    refs = await loadImagesBestEffort(imgs.map((im) => ({ localPath: im.local_path, url: im.image_url })));
  } catch (err) {
    return { ok: false, error: `下载来源图失败：${err instanceof Error ? err.message : String(err)}` };
  }

  // 二创素材(remix)不走这套通用重试(它要走 vision 拆解+变体轴);让用户回「我关注的商品」重新二创。
  if (asset.category === 'remix') return { ok: false, error: '二创素材请回「我关注的商品」对该商品重新二创' };
  const prompt = getEffectivePrompt(store, input.userId, asset.category);
  store.delete(COLLECTIONS.ASSETS, input.assetId); // 删旧 failed，重抠/重生成覆盖
  const now = new Date().toISOString();
  const base = { user_id: input.userId, category: asset.category, product_id: asset.product_id, source_image_ids: ids, created_at: now };
  try {
    const res = await generateImagesWithRetry({ prompt, referenceImages: refs, abortSignal: AbortSignal.timeout(GEN_TIMEOUT_MS) }, 3, `重试(${asset.category})`, {
      product: asset.product_id ? store.get<ProductRow>(COLLECTIONS.PRODUCTS, asset.product_id)?.title || asset.product_id : undefined,
      sources: imgs.map((im) => im.image_url),
    });
    const out = res.images[0];
    if (!out?.localPath) throw new Error('图片服务商未返回结果');
    store.create(COLLECTIONS.ASSETS, { ...base, image_path: out.localPath, status: 'success' });
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    store.create(COLLECTIONS.ASSETS, { ...base, status: 'failed', failure_reason: reason });
    return { ok: false, error: reason };
  }
}
