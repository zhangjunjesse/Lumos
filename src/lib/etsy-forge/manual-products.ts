// 手攒产品:用户在「我的产品」里手动新建的产品组(无 Etsy 采集来源)。内联生成的图挂到它名下。
// 删除手攒产品时,一并删掉它名下生成的图(mockups)。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { COLLECTIONS, type ManualProductRow, type MockupRow } from './types';

export function createManualProduct(store: AppDataStore, userId: string, name: string): ManualProductRow {
  const row = store.create(COLLECTIONS.MANUAL_PRODUCTS, {
    user_id: userId,
    name: name.trim() || '手攒产品',
    created_at: new Date().toISOString(),
  });
  return row as ManualProductRow;
}

export function listManualProducts(store: AppDataStore, userId: string): ManualProductRow[] {
  return store.query<ManualProductRow>(COLLECTIONS.MANUAL_PRODUCTS, {
    filter: { user_id: userId },
    orderBy: { field: 'created_at', direction: 'desc' },
    limit: 500,
  });
}

export function deleteManualProduct(store: AppDataStore, userId: string, id: string): boolean {
  const row = store.get<ManualProductRow>(COLLECTIONS.MANUAL_PRODUCTS, id);
  if (!row || row.user_id !== userId) return false;
  // 连带删除该手攒产品名下的生成图
  const mockups = store.query<MockupRow>(COLLECTIONS.MOCKUPS, { filter: { user_id: userId, source_product_id: id }, limit: 1000 });
  for (const m of mockups) store.delete(COLLECTIONS.MOCKUPS, m.id);
  return store.delete(COLLECTIONS.MANUAL_PRODUCTS, id);
}
