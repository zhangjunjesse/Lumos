// 单商品重抓评论：复用详情采集器抓评论(它连带爬图，但这里只取 reviews、不动详情图)，
// 删旧评论存新 + 更新 review_count。走后台 AdsPower(同详情采集那套，不引入新浏览器逻辑)。
// 不 mock：抓不到/失败如实返回原因。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { collectProductDetailImages } from './detail-collector';
import { COLLECTIONS, type ProductRow, type ReviewRow } from './types';

const MAX_REVIEWS = 500;

export interface RunReviewRecollectResult {
  ok: boolean;
  count: number;
  error?: string;
}

export async function runReviewRecollect(
  store: AppDataStore,
  input: { userId: string; productId: string; browserContextId?: string },
): Promise<RunReviewRecollectResult> {
  const product = store.get<ProductRow>(COLLECTIONS.PRODUCTS, input.productId);
  if (!product || product.user_id !== input.userId) return { ok: false, count: 0, error: '商品不存在' };
  if (!product.url) return { ok: false, count: 0, error: '商品没有链接，无法抓评论' };

  const result = await collectProductDetailImages({
    listingId: product.listing_id,
    productUrl: product.url,
    browserContextId: input.browserContextId,
    maxReviews: MAX_REVIEWS,
  });
  if (result.reviews.length === 0) {
    return { ok: false, count: 0, error: result.failureReason || '没抓到评论（可能该商品确实没有评论，或被登录墙/反爬挡了）' };
  }

  // 只更新评论：删旧存新，不动详情图。
  const old = store.query<ReviewRow>(COLLECTIONS.REVIEWS, { filter: { product_id: input.productId }, limit: 5000 });
  for (const o of old) store.delete(COLLECTIONS.REVIEWS, o.id);
  const now = new Date().toISOString();
  for (const rv of result.reviews) {
    store.create(COLLECTIONS.REVIEWS, {
      user_id: input.userId,
      product_id: input.productId,
      listing_id: product.listing_id,
      author: rv.author ?? undefined,
      rating: rv.rating ?? undefined,
      date: rv.date ?? undefined,
      region: rv.region ?? undefined,
      text: rv.text,
      created_at: now,
    });
  }
  store.update<ProductRow>(COLLECTIONS.PRODUCTS, input.productId, { review_count: result.reviews.length });
  return { ok: true, count: result.reviews.length };
}
