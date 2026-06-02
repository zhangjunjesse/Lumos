// 有限并发：批量图片生成(抠印花/分析素材/抠姿势/产品合成)同时跑 N 个，N 来自设置(默认 5)。
// 不无限全开——避免一堆请求瞬间挤爆中转站、被限流/排队。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS } from './types';

const DEFAULT_CONCURRENCY = 5;
const MAX_CONCURRENCY = 20;

// 读「设置」里的图片生成并发度，clamp 到 [1, 20]，默认 5。
export function getImageConcurrency(store: AppDataStore): number {
  try {
    const row = store.query<{ image_concurrency?: number }>(COLLECTIONS.APP_SETTINGS, { limit: 1 })[0];
    const n = typeof row?.image_concurrency === 'number' ? Math.floor(row.image_concurrency) : DEFAULT_CONCURRENCY;
    return Math.max(1, Math.min(MAX_CONCURRENCY, n));
  } catch {
    return DEFAULT_CONCURRENCY;
  }
}

// 并发跑 fn(item)，同时最多 limit 个；保持结果顺序与 items 一致。
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length || 1));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
