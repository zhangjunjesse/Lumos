// 第二步编排：对勾选的商品逐个 collectProductDetailImages 爬详情图 → 入 etsy_forge_images（图库）。
// 重爬覆盖该商品旧详情图。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { collectProductDetailImages } from './detail-collector';
import {
  COLLECTIONS,
  type DetailImageRow,
  type ProductRow,
  type RunStatus,
} from './types';

export interface RunDetailCollectInput {
  userId: string;
  productIds: string[];
  browserContextId?: string;
  isAborted?: () => boolean;
  appendLog?: (msg: string) => void;
}

export interface RunDetailCollectResult {
  runId: string;
  okProducts: number;
  failProducts: number;
  totalImages: number;
  error?: string;
}

export async function runDetailCollect(
  store: AppDataStore,
  input: RunDetailCollectInput,
): Promise<RunDetailCollectResult> {
  const startedAt = new Date().toISOString();
  const run = store.create(COLLECTIONS.RUNS, {
    user_id: input.userId,
    kind: 'detail_collect',
    products_found: input.productIds.length,
    ehunt_ok_count: 0,
    images_collected: 0,
    status: 'running',
    started_at: startedAt,
  });

  let totalImages = 0;
  let okProducts = 0;
  let failProducts = 0;

  try {
    for (const pid of input.productIds) {
      if (input.isAborted?.()) break;
      const product = store.get<ProductRow>(COLLECTIONS.PRODUCTS, pid);
      if (!product) continue;
      store.update<ProductRow>(COLLECTIONS.PRODUCTS, pid, { detail_status: 'running' });

      const result = await collectProductDetailImages({
        productUrl: product.url,
        listingId: product.listing_id,
        browserContextId: input.browserContextId,
        isAborted: input.isAborted,
        appendLog: input.appendLog,
      });

      if (result.ok) {
        const old = store.query<DetailImageRow>(COLLECTIONS.IMAGES, {
          filter: { product_id: pid },
          limit: 1000,
        });
        for (const o of old) store.delete(COLLECTIONS.IMAGES, o.id);
        for (const img of result.images) {
          store.create(COLLECTIONS.IMAGES, {
            user_id: input.userId,
            product_id: pid,
            listing_id: product.listing_id,
            keyword: product.keyword,
            image_url: img.imageUrl,
            is_main: img.isMain,
            position: img.position,
            created_at: new Date().toISOString(),
          });
        }
        store.update<ProductRow>(COLLECTIONS.PRODUCTS, pid, {
          detail_status: 'success',
          detail_image_count: result.images.length,
          detail_failure_reason: undefined,
        });
        totalImages += result.images.length;
        okProducts++;
      } else {
        store.update<ProductRow>(COLLECTIONS.PRODUCTS, pid, {
          detail_status: 'failed',
          detail_failure_reason: result.failureReason,
        });
        failProducts++;
      }
    }

    const status: RunStatus = failProducts === 0 ? 'success' : okProducts === 0 ? 'failed' : 'partial';
    store.update(COLLECTIONS.RUNS, run.id, {
      images_collected: totalImages,
      status,
      ended_at: new Date().toISOString(),
    });
    return { runId: run.id, okProducts, failProducts, totalImages };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    store.update(COLLECTIONS.RUNS, run.id, {
      images_collected: totalImages,
      status: 'failed',
      failure_reason: reason,
      ended_at: new Date().toISOString(),
    });
    return { runId: run.id, okProducts, failProducts, totalImages, error: reason };
  }
}
