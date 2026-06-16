// 产品开发 — listing CRUD + 从一张出图(mockup)新建。集中写库逻辑，route 只做参数解析。
// 关键(用户反馈)：导入是「一张产品图」粒度，不是整组——一个 source_product_id 下常有多个不同设计，
// 整组塞会把"别的产品"混进来。导入只预填：① 选中的那张产品图(主图) ② 这张图用的印花(细节图)。
// 其余图位留空，由用户在「图片」子 tab 自己挑。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS, type MockupRow } from '../types';
import { emptyListingDefaults, type ListingPhoto, type ListingRow } from './types';

const serveUrl = (p: string) => `/api/media/serve?path=${encodeURIComponent(p)}`;
// 印花来源(design_ref)/图路径可能是本地路径或已是可渲染 url，统一成可渲染 src。
function toSrc(ref: string): string {
  return /^(https?:|\/api\/)/.test(ref) ? ref : serveUrl(ref);
}

export function listListings(store: AppDataStore, userId: string): ListingRow[] {
  return store.query<ListingRow>(COLLECTIONS.LISTINGS, {
    filter: { user_id: userId },
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 1000,
  });
}

export function getListing(store: AppDataStore, userId: string, id: string): ListingRow | null {
  const row = store.get<ListingRow>(COLLECTIONS.LISTINGS, id);
  return row && row.user_id === userId ? row : null;
}

export function createBlankListing(store: AppDataStore, userId: string, name?: string): ListingRow {
  const now = new Date().toISOString();
  const base = emptyListingDefaults();
  return store.create<ListingRow>(COLLECTIONS.LISTINGS, {
    ...base,
    internal_name: (name || '').trim() || base.internal_name,
    user_id: userId,
    created_at: now,
    updated_at: now,
  } as ListingRow);
}

// 从「我的产品」一张产品图(mockup)新建：预填该图为主图 + 它用的印花为细节图。
export function createListingFromMockup(store: AppDataStore, userId: string, mockupId: string, name?: string): ListingRow {
  const m = store.get<MockupRow>(COLLECTIONS.MOCKUPS, mockupId);
  if (!m || m.user_id !== userId) throw new Error('选中的产品图不存在');

  const photos: ListingPhoto[] = [];
  if (m.image_path) {
    photos.push({ role: 'main', position: 0, src: serveUrl(m.image_path), sourceType: 'mockup', sourceId: m.id, isMain: true });
  }
  const designSrc = m.design_ref ? toSrc(m.design_ref) : '';
  if (designSrc) {
    // 这张产品图用的印花 → 细节图(展示印花本身)。
    photos.push({ role: 'detail', position: 0, src: designSrc, sourceType: 'asset', isMain: false });
  }

  const now = new Date().toISOString();
  const base = emptyListingDefaults();
  return store.create<ListingRow>(COLLECTIONS.LISTINGS, {
    ...base,
    user_id: userId,
    internal_name: (name || '').trim() || (typeof m.source_product_title === 'string' ? m.source_product_title : '') || base.internal_name,
    source_kind: 'from_group',
    source_product_id: m.source_product_id,
    design_src: designSrc, // 印花作为后续所有图位生成的种子
    photos,
    created_at: now,
    updated_at: now,
  } as ListingRow);
}

// 局部更新：白名单字段，禁止改 id/user_id/created_at。updated_at 由 data-store auto。
const MUTABLE_FIELDS = new Set<keyof ListingRow>([
  'internal_name', 'status', 'title', 'description', 'tags', 'materials', 'design_src', 'photos', 'video_src',
  'price', 'currency', 'quantity', 'sku', 'variations', 'personalization', 'taxonomy_path',
  'section', 'listing_details', 'listing_type', 'renewal', 'production_partner', 'attributes',
  'shipping', 'copy_draft', 'etsy_listing_url', 'etsy_listing_id', 'note',
]);

export function updateListing(
  store: AppDataStore,
  userId: string,
  id: string,
  patch: Partial<ListingRow>,
): ListingRow | null {
  if (!getListing(store, userId, id)) return null;
  const clean: Partial<ListingRow> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (MUTABLE_FIELDS.has(k as keyof ListingRow)) (clean as Record<string, unknown>)[k] = v;
  }
  clean.updated_at = new Date().toISOString();
  return store.update<ListingRow>(COLLECTIONS.LISTINGS, id, clean);
}

export function deleteListing(store: AppDataStore, userId: string, id: string): boolean {
  if (!getListing(store, userId, id)) return false;
  return store.delete(COLLECTIONS.LISTINGS, id);
}
