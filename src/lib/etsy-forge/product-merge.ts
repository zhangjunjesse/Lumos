// 产品合成：印花 × 确定颜色空白 T → inpaint → 带印花平铺 T(颜色焊在产品图里、印花贴布料)。
// 拆成「前置(prepareMerge)」+「单张(mergeOneProduct)」：route 同步做前置(错误立即报)，
// 再 fire-and-forget 逐张跑(请求秒返回、各张独立后台跑完落库，不会因请求超时被取消)。
// 走「设置→图片生成」服务商(受 media 锁定)。不 mock：失败如实记 failed。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEffectivePrompt } from './prompt-defaults';
import { generateImagesWithRetry } from './image-gen-retry';
import { loadImageAsBase64, type FetchedImage } from './image-fetch';
import { COLLECTIONS, type AssetRow } from './types';

const MERGE_TIMEOUT_MS = 600_000; // 10min：中转链路长、单张可能慢，给足时间避免本地提前 abort

export interface DesignRef {
  localPath?: string; // 抠的印花有本地路径；灵感图由 route 从 serve url 提取
  url: string;
  label?: string;
  sourceProductId?: string; // 血缘:这印花最初来自哪个采集的 Etsy 商品
}

export interface MergePrep {
  designImg: FetchedImage;
  prompt: string;
}

// 前置：检查图片服务商 + 读印花。失败返回 {error}（route 立即报给前端），成功返回 {designImg, prompt}。
export async function prepareMerge(
  store: AppDataStore,
  userId: string,
  design: DesignRef,
): Promise<{ error: string } | MergePrep> {
  const provider = resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false });
  if (!provider) {
    return { error: '未配置图片服务商。去 Lumos「设置 → 图片生成」选一个支持图像编辑的服务商（如 Nano banana / GPT-Image）。' };
  }
  try {
    const designImg = await loadImageAsBase64({ localPath: design.localPath, url: design.url });
    return { designImg, prompt: getEffectivePrompt(store, userId, 'product-merge') };
  } catch (err) {
    return { error: `读取印花失败：${err instanceof Error ? err.message : String(err)}` };
  }
}

// 单张：产品图(确定颜色空白 T) + 印花 inpaint → 存 mockup(success/failed)。每张独立、不互相影响。
export async function mergeOneProduct(
  store: AppDataStore,
  userId: string,
  design: DesignRef,
  prep: MergePrep,
  productAssetId: string,
): Promise<boolean> {
  const asset = store.get<AssetRow>(COLLECTIONS.ASSETS, productAssetId);
  const now = new Date().toISOString();
  const base = {
    user_id: userId,
    design_label: design.label,
    design_ref: design.localPath || design.url,
    source_product_id: design.sourceProductId,
    product_asset_id: productAssetId,
    created_at: now,
  };
  if (!asset || asset.user_id !== userId || !asset.image_path) {
    store.create(COLLECTIONS.MOCKUPS, { ...base, status: 'failed', failure_reason: '产品图不存在或无本地图' });
    return false;
  }
  try {
    const productImg = await loadImageAsBase64({
      localPath: asset.image_path,
      url: `/api/media/serve?path=${encodeURIComponent(asset.image_path)}`,
    });
    const res = await generateImagesWithRetry(
      { prompt: prep.prompt, referenceImages: [productImg, prep.designImg], abortSignal: AbortSignal.timeout(MERGE_TIMEOUT_MS) },
      3,
      '产品合成',
      {
        sources: [
          `/api/media/serve?path=${encodeURIComponent(asset.image_path)}`,
          design.localPath ? `/api/media/serve?path=${encodeURIComponent(design.localPath)}` : design.url,
        ],
      },
    );
    const out = res.images[0];
    if (!out?.localPath) throw new Error('图片服务商未返回结果（该模型可能不支持图像编辑）');
    store.create(COLLECTIONS.MOCKUPS, { ...base, image_path: out.localPath, status: 'success' });
    return true;
  } catch (err) {
    store.create(COLLECTIONS.MOCKUPS, {
      ...base,
      status: 'failed',
      failure_reason: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
