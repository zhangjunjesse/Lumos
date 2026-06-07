// 「图/URL → 产品」引擎:把一张外部图(微信发的 / 商品 URL 抓的主图)做成「我的产品」里一张二创产品图。
// 流程:建手攒产品 → 图当源 → 按方向二创出新印花(remix 素材) → 锁色合成到默认空白 T → 产品图(MOCKUP,挂手攒产品)。
// 复用 etsy 两步法零件 + 默认空白 T。URL 输入由上游先抓成 imageUrl/imagePath,这里不管来源。不 mock:失败如实返回。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { generateImagesWithRetry } from './image-gen-retry';
import { loadImageAsBase64, type FetchedImage } from './image-fetch';
import { listStrategies } from './remix-strategies';
import { buildDirectionDesignPrompt } from './composer';
import { prepareMerge, mergeOneProduct } from './product-merge';
import { getOrCreateDefaultBlankTee } from './default-blank-tee';
import { COLLECTIONS, type RemixStrategyRow } from './types';

const TIMEOUT_MS = 600_000;
const serve = (p: string) => `/api/media/serve?path=${encodeURIComponent(p)}`;

// 选方向:给了 code 用它(启用的);否则默认(is_default)→ 兜底第一条。
function pickDirection(store: AppDataStore, userId: string, code?: string): RemixStrategyRow | null {
  const all = listStrategies(store, userId).filter((s) => s.enabled);
  if (all.length === 0) return null;
  if (code) {
    const hit = all.find((s) => s.code === code);
    if (hit) return hit;
  }
  return all.find((s) => s.is_default) ?? all[0];
}

export interface MakeProductResult {
  ok: boolean;
  productId?: string; // 新建的手攒产品 id
  error?: string;
}

export async function makeProductFromImage(
  store: AppDataStore,
  userId: string,
  input: { imagePath?: string; imageUrl?: string; directionCode?: string; productName?: string },
): Promise<MakeProductResult> {
  if (!input.imagePath && !input.imageUrl) return { ok: false, error: '没有图片(需 imagePath 或 imageUrl)' };
  if (!resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false })) {
    return { ok: false, error: '未配置图片服务商。去「设置 → 图片生成」选一个支持图像编辑的服务商。' };
  }
  const dir = pickDirection(store, userId, input.directionCode);
  if (!dir) return { ok: false, error: '没有可用的二创方向(去「设置 → 二创方向矩阵」加一个)' };

  // 源图(微信图本地路径 / URL 抓到的)。
  const srcUrl = input.imageUrl || (input.imagePath ? serve(input.imagePath) : '');
  let srcImg: FetchedImage;
  try {
    srcImg = await loadImageAsBase64({ localPath: input.imagePath, url: srcUrl });
  } catch (err) {
    return { ok: false, error: `读取图片失败:${err instanceof Error ? err.message : String(err)}` };
  }

  // 默认空白 T(没有就生成一件)。
  const tee = await getOrCreateDefaultBlankTee(store, userId);
  if ('error' in tee) return { ok: false, error: tee.error };

  // 建手攒产品(这张图→产品的归属组)。
  const now = () => new Date().toISOString();
  const product = store.create(COLLECTIONS.MANUAL_PRODUCTS, { user_id: userId, name: input.productName || `图片产品 · ${dir.label}`, created_at: now() });
  const productId = product.id as string;

  // ① 按方向把源图改成新印花(设计稿,存 remix 素材,挂这个手攒产品)。
  let newDesignPath: string;
  try {
    const res = await generateImagesWithRetry(
      { prompt: buildDirectionDesignPrompt(dir), referenceImages: [srcImg], abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
      3,
      `图→二创·${dir.label}`,
      { sources: [input.imagePath ? serve(input.imagePath) : input.imageUrl ?? ''] },
    );
    const out = res.images[0];
    if (!out?.localPath) throw new Error('服务商未返回二创印花');
    newDesignPath = out.localPath;
    store.create(COLLECTIONS.ASSETS, { user_id: userId, category: 'remix', product_id: productId, description: `方向·${dir.label}`, source_image_ids: [], image_path: newDesignPath, status: 'success', created_at: now() });
  } catch (err) {
    return { ok: false, productId, error: `出二创印花失败:${err instanceof Error ? err.message : String(err)}` };
  }

  // ② 把新印花锁色合成到默认空白 T → 产品图(MOCKUP 挂手攒产品)。
  const design = { localPath: newDesignPath, url: serve(newDesignPath), label: `方向·${dir.label}`, sourceProductId: productId };
  const prep = await prepareMerge(store, userId, design);
  if ('error' in prep) return { ok: false, productId, error: prep.error };
  const ok = await mergeOneProduct(store, userId, design, prep, tee.assetId);
  return ok ? { ok: true, productId } : { ok: false, productId, error: '产品合成失败(二创印花已留在图库)' };
}
