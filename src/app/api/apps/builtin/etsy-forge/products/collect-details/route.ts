// 第二步：对勾选（或指定）的商品爬详情页所有详情图入图库。同步等结果。

import { NextRequest, NextResponse } from 'next/server';
import { runDetailCollect } from '@/lib/etsy-forge/detail-collect';
import { getBrowserContextId, getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type ProductRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { product_ids?: string[] };
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);

    // 未指定 → 取该用户所有 selected=true 的商品
    let productIds = Array.isArray(body.product_ids) ? body.product_ids : [];
    if (productIds.length === 0) {
      productIds = store
        .query<ProductRow>(COLLECTIONS.PRODUCTS, { filter: { user_id: userId, selected: true }, limit: 200 })
        .map((p) => p.id);
    }
    if (productIds.length === 0) {
      return NextResponse.json({ error: '没有勾选任何商品' }, { status: 400 });
    }

    const result = await runDetailCollect(store, {
      userId,
      productIds,
      browserContextId: getBrowserContextId(store),
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
