// 「采集店铺」步(db/去重层):给一个商品 → 取其 shop_url → 按 shop_key 去重 → 新店才真采,旧店只挂关联。
// 无店铺链接=软跳过(返回摘要,不抛);真采失败=抛(SOP 可选步会记录失败但不断主链);EHunt 抓不到=ehunt_status=unavailable(不编)。
// recollectShopById:店铺卡「重采」用,按已存 shop.url 重采,不经商品/SOP。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { withLock } from '@/lib/async-lock';
import { collectShop, type ShopCollectResult } from './shop-collector';
import { getBrowserContextId, BROWSER_STEP_LOCK } from './store';
import { COLLECTIONS, type ProductRow, type ShopRow } from './types';

const now = () => new Date().toISOString();

/** 从店铺 URL 取去重键(slug,小写)。 */
function shopKeyOf(url: string): string | null {
  const m = url.match(/\/shop\/([^/?#]+)/);
  return m ? m[1].toLowerCase() : null;
}

/** 把一次成功采集写回 ShopRow(基本信息/装修/EHunt bar);addProductId 非空时把该商品并入关联。 */
function applyShopData(store: AppDataStore, shopId: string, prev: ShopRow, r: ShopCollectResult, addProductId?: string): void {
  const d = r.data!;
  const ids = addProductId ? [...new Set([...(prev.source_product_ids ?? []), addProductId])] : prev.source_product_ids ?? [];
  store.update<ShopRow>(COLLECTIONS.SHOPS, shopId, {
    shop_name: d.shopName ?? prev.shop_name,
    avatar_url: d.avatarUrl ?? undefined,
    location: d.location ?? undefined,
    total_sales: d.totalSales ?? undefined,
    review_count: d.reviewCount ?? undefined,
    review_rating: d.reviewRating ?? undefined,
    since_year: d.sinceYear ?? undefined,
    announcement: d.announcement ?? undefined,
    banner_path: r.bannerPath,
    rep_listing_paths: r.repListingPaths,
    homepage_screenshot_path: r.screenshotPath,
    ehunt_json: d.ehuntRaw ? JSON.stringify({ raw: d.ehuntRaw }) : undefined,
    ehunt_bar_path: r.ehuntBarPath,
    ehunt_status: d.ehuntRaw || r.ehuntBarPath ? 'success' : 'unavailable',
    collect_status: 'success',
    failure_reason: '',
    source_product_ids: ids,
    collected_at: now(),
  });
}

export async function runShopCollect(store: AppDataStore, userId: string, productId: string): Promise<string> {
  const p = store.get<ProductRow>(COLLECTIONS.PRODUCTS, productId);
  if (!p?.shop_url) return '该商品没有店铺链接(详情未采到),跳过';
  const key = shopKeyOf(p.shop_url);
  if (!key) return '店铺链接无法解析,跳过';

  // 去重:同店已成功采过 → 只把本商品挂进 source_product_ids,不重采。
  const existing = store.query<ShopRow>(COLLECTIONS.SHOPS, { filter: { user_id: userId, shop_key: key }, limit: 1 })[0];
  if (existing?.collect_status === 'success') {
    const ids = [...new Set([...(existing.source_product_ids ?? []), productId])];
    store.update(COLLECTIONS.SHOPS, existing.id, { source_product_ids: ids });
    return `已采过店铺「${existing.shop_name}」,关联本商品`;
  }

  const row =
    existing ??
    store.create<ShopRow>(COLLECTIONS.SHOPS, {
      user_id: userId,
      shop_key: key,
      shop_name: p.shop_name ?? key,
      url: p.shop_url,
      ehunt_status: 'idle',
      collect_status: 'running',
      source_product_ids: [productId],
      created_at: now(),
    } as ShopRow);
  store.update(COLLECTIONS.SHOPS, row.id, { collect_status: 'running', failure_reason: '' });

  const r = await collectShop({ shopUrl: p.shop_url, browserContextId: getBrowserContextId(store) });
  if (!r.ok || !r.data) {
    store.update(COLLECTIONS.SHOPS, row.id, { collect_status: 'failed', failure_reason: r.failureReason });
    throw new Error(r.failureReason || '店铺采集失败');
  }
  applyShopData(store, row.id, row, r, productId);
  return `店铺「${r.data.shopName ?? key}」已采 · EHunt ${r.data.ehuntRaw ? '✓' : '未接入'}`;
}

/** 店铺卡「重采」:按已存 shop.url 重新采(刷新基本信息/装修/EHunt bar),不经商品。 */
export async function recollectShopById(store: AppDataStore, userId: string, shopId: string): Promise<{ ok: boolean; error?: string }> {
  const row = store.get<ShopRow>(COLLECTIONS.SHOPS, shopId);
  if (!row || row.user_id !== userId) return { ok: false, error: '店铺不存在' };
  store.update(COLLECTIONS.SHOPS, shopId, { collect_status: 'running', failure_reason: '' });
  // 走浏览器串行锁:与正在跑的 SOP 采详情/采店铺步串行,避免抢同一个 AdsPower 连接。
  const r = await withLock(BROWSER_STEP_LOCK, () => collectShop({ shopUrl: row.url, browserContextId: getBrowserContextId(store) }));
  if (!r.ok || !r.data) {
    store.update(COLLECTIONS.SHOPS, shopId, { collect_status: 'failed', failure_reason: r.failureReason });
    return { ok: false, error: r.failureReason };
  }
  applyShopData(store, shopId, row, r);
  return { ok: true };
}
