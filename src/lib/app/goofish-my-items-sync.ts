/**
 * 同步「我的在售商品」到 Lumos 应用层 collection `xianyu_items`。
 *
 * 数据流：
 *   闲鱼 mtop.idle.web.xyh.item.list（浏览器代签）
 *   → fetchMyItems（src/lib/goofish/fetch-my-items.ts）
 *   → upsert 到 collection xianyu_items（按 item_id 去重）
 *
 * 与「商品库 products」的关系：
 *   - products = Lumos 本地货源（标题/卡密/AI 提示词）— 你建的
 *   - xianyu_items = 闲鱼平台上你账号挂着的真实商品 — 同步来的
 *   - product_listings = 两边关联（哪份本地货源挂到了哪个 item_id）
 */
import { fetchMyItems, type XianyuSellerItem } from '@/lib/goofish/fetch-my-items';

import { isGoofishNativeApp } from './goofish-app-sync';
import type { AppManifest } from './manifest/types';
import type { AppDataStore, AppRow } from './runtime/data-store';

interface XianyuItemRow extends Record<string, unknown> {
  item_id?: string;
  account_unb?: string;
  title?: string;
  price?: number;
  price_text?: string;
  image_url?: string;
  item_status?: number;
  shipping_info?: string;
  want_count?: number;
  raw_json?: string;
  first_seen_at?: string;
  last_synced_at?: string;
  /** 本地货源是否已挂这个 item（通过 product_listings.item_id 反查） */
  has_local_product?: boolean;
}

interface ProductListingRow extends Record<string, unknown> {
  item_id?: string;
}

export interface SyncMyItemsInput {
  manifest: AppManifest;
  store: AppDataStore;
  accountUnb: string;
  browserContextId: string;
  pageSize?: number;
  maxPages?: number;
}

export interface SyncMyItemsResult {
  ok: boolean;
  upserted: number;
  newItems: number;
  totalFetched: number;
  pagesFetched: number;
  message: string;
}

export async function syncMyItems(input: SyncMyItemsInput): Promise<SyncMyItemsResult> {
  if (!isGoofishNativeApp(input.manifest)) {
    return makeFail('当前应用不是闲鱼类应用。');
  }
  if (!input.accountUnb) {
    return makeFail('缺少 accountUnb。');
  }

  const result = await fetchMyItems({
    userId: input.accountUnb,
    browserContextId: input.browserContextId,
    pageSize: input.pageSize,
    maxPages: input.maxPages,
  });

  if (!result.ok) {
    return {
      ok: false,
      upserted: 0,
      newItems: 0,
      totalFetched: 0,
      pagesFetched: result.pagesFetched,
      message: result.message ?? '拉取商品失败',
    };
  }

  // 收集已挂载的 item_id 用于回填 has_local_product
  const linkedItemIds = new Set(
    input.store.query<ProductListingRow>('product_listings', { limit: 1000 })
      .map((l) => typeof l.item_id === 'string' ? l.item_id : '')
      .filter(Boolean),
  );

  const now = new Date().toISOString();
  let upserted = 0;
  let newItems = 0;

  for (const item of result.items) {
    const existing = findByItemId(input.store, item.itemId);
    if (existing) {
      input.store.update<XianyuItemRow>('xianyu_items', existing.id, {
        title: item.title,
        price: item.price,
        price_text: item.priceText,
        image_url: item.imageUrl,
        item_status: item.itemStatus,
        shipping_info: item.shippingInfo,
        want_count: item.wantCount,
        raw_json: '',
        last_synced_at: now,
        has_local_product: linkedItemIds.has(item.itemId),
      });
      upserted += 1;
    } else {
      input.store.create<XianyuItemRow>('xianyu_items', {
        item_id: item.itemId,
        account_unb: input.accountUnb,
        title: item.title,
        price: item.price,
        price_text: item.priceText,
        image_url: item.imageUrl,
        item_status: item.itemStatus,
        shipping_info: item.shippingInfo,
        want_count: item.wantCount,
        raw_json: '',
        first_seen_at: now,
        last_synced_at: now,
        has_local_product: linkedItemIds.has(item.itemId),
      });
      newItems += 1;
      upserted += 1;
    }
  }

  return {
    ok: true,
    upserted,
    newItems,
    totalFetched: result.totalFetched,
    pagesFetched: result.pagesFetched,
    message: `已同步 ${result.totalFetched} 件商品（新 ${newItems}，更新 ${upserted - newItems}）`,
  };
}

function findByItemId(
  store: AppDataStore,
  itemId: string,
): AppRow<XianyuItemRow> | null {
  if (!itemId) return null;
  return store.query<XianyuItemRow>('xianyu_items', {
    filter: { item_id: itemId }, limit: 1,
  })[0] ?? null;
}

function makeFail(message: string): SyncMyItemsResult {
  return {
    ok: false, upserted: 0, newItems: 0, totalFetched: 0, pagesFetched: 0, message,
  };
}

/** 给某 xianyu_item 关联到本地 product（创建 product_listings 行）。 */
export function linkXianyuItemToProduct(input: {
  store: AppDataStore;
  itemId: string;
  productId: string;
  accountUnb: string;
  itemTitle: string;
  price: number;
}): { ok: boolean; listingId?: string; message: string } {
  const existing = input.store.query<ProductListingRow>('product_listings', {
    filter: { item_id: input.itemId }, limit: 1,
  })[0];
  if (existing) {
    return {
      ok: false,
      message: '该闲鱼商品已经关联了一个本地货源，请先去「关联商品」里解除旧关联。',
    };
  }
  const created = input.store.create('product_listings', {
    product_id: input.productId,
    account_unb: input.accountUnb,
    account_label: input.accountUnb,
    item_id: input.itemId,
    item_title: input.itemTitle,
    listed_price: input.price,
    status: 'live',
    listed_at: new Date().toISOString(),
    publish_status: 'success',
    last_publish_at: new Date().toISOString(),
  });
  // 反查更新 xianyu_items.has_local_product
  const xianyuItem = findByItemId(input.store, input.itemId);
  if (xianyuItem) {
    input.store.update<XianyuItemRow>('xianyu_items', xianyuItem.id, {
      has_local_product: true,
    });
  }
  return { ok: true, listingId: created.id, message: '已关联到本地货源' };
}
