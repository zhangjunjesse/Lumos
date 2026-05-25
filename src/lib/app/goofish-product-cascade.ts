import type { AppDataStore } from './runtime/data-store';

interface ProductListingRow extends Record<string, unknown> {
  product_id?: string;
}

interface FulfillmentLogRow extends Record<string, unknown> {
  product_id?: string;
  product_title?: string;
}

export interface CascadeDeleteProductResult {
  ok: boolean;
  message: string;
  removedListings: number;
  orphanedLogs: number;
}

export function cascadeDeleteProduct(
  store: AppDataStore,
  productId: string,
): CascadeDeleteProductResult {
  if (!productId) {
    return { ok: false, message: '缺少 productId。', removedListings: 0, orphanedLogs: 0 };
  }
  const product = store.get('products', productId);
  if (!product) {
    return { ok: false, message: '商品不存在或已删除。', removedListings: 0, orphanedLogs: 0 };
  }
  const titleField = (product as Record<string, unknown>).title;
  const productTitle = typeof titleField === 'string' ? titleField : '';

  const listings = store.query<ProductListingRow>('product_listings', {
    filter: { product_id: productId }, limit: 500,
  });
  let removedListings = 0;
  for (const l of listings) {
    if (store.delete('product_listings', l.id)) removedListings += 1;
  }

  const logs = store.query<FulfillmentLogRow>('fulfillment_log', {
    filter: { product_id: productId }, limit: 1000,
  });
  let orphanedLogs = 0;
  for (const log of logs) {
    const stamped = store.update<FulfillmentLogRow>('fulfillment_log', log.id, {
      product_title: log.product_title || productTitle ? `${log.product_title ?? productTitle}（商品已删除）` : '（商品已删除）',
    });
    if (stamped) orphanedLogs += 1;
  }

  store.delete('products', productId);

  return {
    ok: true,
    message: `已删除商品${productTitle ? `「${productTitle}」` : ''}，连带清理 ${removedListings} 条关联商品，${orphanedLogs} 条历史发货记录被标记。`,
    removedListings,
    orphanedLogs,
  };
}
