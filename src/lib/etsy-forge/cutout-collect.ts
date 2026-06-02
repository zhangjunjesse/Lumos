// 抠图编排：一个产品调一次图片服务——把该产品的图（默认全部，imageIds 指定时只用选中的）
// 一起作为参考图喂给服务商，输出 1 张抠图结果。重抠覆盖该产品旧结果。
// 抠图引擎走 Lumos「设置 → 图片生成」配的服务商（generateImages 内部解析 image override，
// 受 media 锁定控制——锁定时只能用 system origin 的图片服务商）。
// 不 mock：抠不出（服务商没配/不支持图像编辑/下载失败）如实记 failed + 原因。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { getEffectivePrompt } from './prompt-defaults';
import { generateImagesWithRetry } from './image-gen-retry';
import { getImageConcurrency, mapLimit } from './concurrency';
import { loadImagesBestEffort } from './image-fetch';
import { COLLECTIONS, type CutoutRow, type DetailImageRow, type ProductRow } from './types';

const CUTOUT_TIMEOUT_MS = 600_000; // 10min：中转链路长、单张可能慢，给足时间避免本地提前 abort

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

  // 抠一个商品：它所有(或选中)图合起来出 1 张印花。返回结果给上层统计。
  const cutoutOne = async (pid: string): Promise<'ok' | 'fail' | 'skip'> => {
    if (input.isAborted?.()) return 'skip';
    const product = store.get<ProductRow>(COLLECTIONS.PRODUCTS, pid);
    if (!product || product.user_id !== input.userId) return 'skip';

    let imgs = store.query<DetailImageRow>(COLLECTIONS.IMAGES, { filter: { product_id: pid }, limit: 1000 });
    if (imageFilter) imgs = imgs.filter((i) => imageFilter.has(i.id));
    if (imgs.length === 0) return 'skip';

    store.update<ProductRow>(COLLECTIONS.PRODUCTS, pid, { cutout_status: 'running' });
    const old = store.query<CutoutRow>(COLLECTIONS.CUTOUTS, { filter: { product_id: pid }, limit: 100 });
    for (const o of old) store.delete(COLLECTIONS.CUTOUTS, o.id);

    const now = new Date().toISOString();
    try {
      log(`▶ 抠图：商品 ${pid}，用 ${imgs.length} 张图`);
      const refs = await loadImagesBestEffort(imgs.map((img) => ({ localPath: img.local_path, url: img.image_url })));
      const res = await generateImagesWithRetry(
        { prompt, referenceImages: refs, abortSignal: AbortSignal.timeout(CUTOUT_TIMEOUT_MS) },
        3,
        '抠印花',
        { product: product.title || pid, sources: imgs.map((i) => i.image_url) },
      );
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
      return 'ok';
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
      return 'fail';
    }
  };

  // 有限并发跑多个商品（并发度来自设置，默认 5）。
  const outcomes = await mapLimit(input.productIds, getImageConcurrency(store), cutoutOne);
  const okProducts = outcomes.filter((o) => o === 'ok').length;
  const failProducts = outcomes.filter((o) => o === 'fail').length;

  return { okProducts, failProducts };
}
