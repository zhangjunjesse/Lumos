// 图库管理：给商品打/去标签、批量删除（商品连带其图 / 单张图）。被 library/tags、library/delete 路由调用。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS, type DetailImageRow, type ProductRow, type ReviewRow } from './types';

const MAX_TAG_LEN = 30;
const MAX_TAGS_PER_PRODUCT = 30;

/** 标签归一化：trim、去空、去重、限长。 */
export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tags) {
    const v = String(t ?? '').trim().slice(0, MAX_TAG_LEN);
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** 给一批商品加/去标签（标签仅商品维度）。返回更新的商品数。 */
export function applyProductTags(
  store: AppDataStore,
  userId: string,
  productIds: string[],
  add: string[],
  remove: string[],
): number {
  const addN = normalizeTags(add);
  const removeSet = new Set(normalizeTags(remove));
  if (addN.length === 0 && removeSet.size === 0) return 0;
  let updated = 0;
  for (const id of productIds) {
    const p = store.get<ProductRow>(COLLECTIONS.PRODUCTS, id);
    if (!p || p.user_id !== userId) continue;
    const current = normalizeTags(p.tags);
    const merged = normalizeTags([...current, ...addN])
      .filter((t) => !removeSet.has(t))
      .slice(0, MAX_TAGS_PER_PRODUCT);
    store.update<ProductRow>(COLLECTIONS.PRODUCTS, id, { tags: merged });
    updated++;
  }
  return updated;
}

/** 批量删除：删商品（连带其所有详情图）/ 删单张详情图（并重算所属商品图数）。 */
export function deleteLibraryEntities(
  store: AppDataStore,
  userId: string,
  input: { productIds?: string[]; imageIds?: string[] },
): { deletedProducts: number; deletedImages: number } {
  let deletedProducts = 0;
  let deletedImages = 0;
  const deletedProductSet = new Set<string>();
  const affectedProducts = new Set<string>();

  for (const pid of input.productIds ?? []) {
    const p = store.get<ProductRow>(COLLECTIONS.PRODUCTS, pid);
    if (!p || p.user_id !== userId) continue;
    const imgs = store.query<DetailImageRow>(COLLECTIONS.IMAGES, { filter: { product_id: pid }, limit: 10000 });
    for (const im of imgs) if (store.delete(COLLECTIONS.IMAGES, im.id)) deletedImages++;
    // 连带删该商品的评论，避免孤儿残留。
    const reviews = store.query<ReviewRow>(COLLECTIONS.REVIEWS, { filter: { product_id: pid }, limit: 10000 });
    for (const rv of reviews) store.delete(COLLECTIONS.REVIEWS, rv.id);
    if (store.delete(COLLECTIONS.PRODUCTS, pid)) {
      deletedProducts++;
      deletedProductSet.add(pid);
    }
  }

  for (const iid of input.imageIds ?? []) {
    const im = store.get<DetailImageRow>(COLLECTIONS.IMAGES, iid);
    if (!im || im.user_id !== userId) continue;
    if (deletedProductSet.has(im.product_id)) continue; // 所属商品已整删
    if (store.delete(COLLECTIONS.IMAGES, iid)) {
      deletedImages++;
      affectedProducts.add(im.product_id);
    }
  }

  // 删了单张图的商品：重算 detail_image_count（归零则状态回 idle）。
  for (const pid of affectedProducts) {
    if (deletedProductSet.has(pid)) continue;
    const c = store.query<DetailImageRow>(COLLECTIONS.IMAGES, { filter: { product_id: pid }, limit: 10000 }).length;
    store.update<ProductRow>(COLLECTIONS.PRODUCTS, pid, {
      detail_image_count: c,
      ...(c === 0 ? { detail_status: 'idle' as const } : {}),
    });
  }

  return { deletedProducts, deletedImages };
}
