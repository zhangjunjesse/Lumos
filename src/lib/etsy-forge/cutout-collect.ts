// 抠图编排：一个产品调一次图片服务——把该产品的图（默认全部，imageIds 指定时只用选中的）
// 一起作为参考图喂给服务商，输出 1 张抠图结果。重抠覆盖该产品旧结果。
// 抠图引擎走 Lumos「设置 → 图片生成」配的服务商（generateImages 内部解析 image override，
// 受 media 锁定控制——锁定时只能用 system origin 的图片服务商）。
// 不 mock：抠不出（服务商没配/不支持图像编辑/下载失败）如实记 failed + 原因。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { generateImages } from '@/lib/image/generate';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEffectivePrompt } from './prompt-defaults';
import { loadImagesBestEffort } from './image-fetch';
import { COLLECTIONS, type CutoutRow, type DetailImageRow, type ProductRow } from './types';

const CUTOUT_TIMEOUT_MS = 180_000;

export interface RunCutoutInput {
  userId: string;
  productIds: string[];
  imageIds?: string[]; // 指定参与抠图的详情图；空 = 该商品全部详情图
  prompt?: string; // 抠图指令；空 = 提示词管理里「抠印花」分类的生效那条
  isAborted?: () => boolean;
  appendLog?: (msg: string) => void;
}

export interface RunCutoutResult {
  okProducts: number;
  failProducts: number;
  error?: string;
}

export async function runCutout(store: AppDataStore, input: RunCutoutInput): Promise<RunCutoutResult> {
  const log = input.appendLog ?? (() => {});

  // 先确认图片服务商可用（没配/锁定无 system 服务商时立即报错，不进循环）。
  const provider = resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false });
  if (!provider) {
    return {
      okProducts: 0,
      failProducts: 0,
      error: '未配置图片服务商。去 Lumos「设置 → 图片生成」选一个支持图像编辑的服务商（如 Nano banana / GPT-Image）。',
    };
  }

  const prompt = input.prompt?.trim() || getEffectivePrompt(store, input.userId, 'cutout');
  const imageFilter = input.imageIds?.length ? new Set(input.imageIds) : null;
  let okProducts = 0;
  let failProducts = 0;

  for (const pid of input.productIds) {
    if (input.isAborted?.()) break;
    const product = store.get<ProductRow>(COLLECTIONS.PRODUCTS, pid);
    if (!product || product.user_id !== input.userId) continue;

    let imgs = store.query<DetailImageRow>(COLLECTIONS.IMAGES, { filter: { product_id: pid }, limit: 1000 });
    if (imageFilter) imgs = imgs.filter((i) => imageFilter.has(i.id));
    if (imgs.length === 0) continue;

    store.update<ProductRow>(COLLECTIONS.PRODUCTS, pid, { cutout_status: 'running' });
    // 重抠覆盖：删该产品旧抠图结果
    const old = store.query<CutoutRow>(COLLECTIONS.CUTOUTS, { filter: { product_id: pid }, limit: 100 });
    for (const o of old) store.delete(COLLECTIONS.CUTOUTS, o.id);

    const now = new Date().toISOString();
    try {
      log(`▶ 抠图：商品 ${pid}，用 ${imgs.length} 张图`);
      // 该产品所有（或选中）图一起作参考，一次调用出 1 张抠图（下载容错：部分成功即用）
      const refs = await loadImagesBestEffort(imgs.map((img) => ({ localPath: img.local_path, url: img.image_url })));
      const res = await generateImages({
        prompt,
        referenceImages: refs,
        abortSignal: AbortSignal.timeout(CUTOUT_TIMEOUT_MS),
      });
      const out = res.images[0];
      if (!out?.localPath) throw new Error('图片服务商未返回抠图结果（可能该模型不支持图像编辑）');
      store.create(COLLECTIONS.CUTOUTS, {
        user_id: input.userId,
        product_id: pid,
        source_count: imgs.length,
        cutout_path: out.localPath,
        status: 'success',
        created_at: now,
      });
      store.update<ProductRow>(COLLECTIONS.PRODUCTS, pid, { cutout_status: 'success', cutout_count: 1 });
      okProducts++;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      store.create(COLLECTIONS.CUTOUTS, {
        user_id: input.userId,
        product_id: pid,
        source_count: imgs.length,
        status: 'failed',
        failure_reason: reason,
        created_at: now,
      });
      store.update<ProductRow>(COLLECTIONS.PRODUCTS, pid, { cutout_status: 'failed', cutout_count: 0 });
      failProducts++;
    }
  }

  return { okProducts, failProducts };
}
