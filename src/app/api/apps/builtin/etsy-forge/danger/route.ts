// 危险操作（前端二次确认才调）：清空图库（详情图）/ 清空商品列表（连带其详情图）。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type DetailImageRow, type ProductRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { action?: string };
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);

    if (body.action === 'clear-library') {
      const imgs = store.query<DetailImageRow>(COLLECTIONS.IMAGES, { filter: { user_id: userId }, limit: 100000 });
      for (const img of imgs) store.delete(COLLECTIONS.IMAGES, img.id);
      return NextResponse.json({ ok: true, affected: imgs.length });
    }

    if (body.action === 'clear-products') {
      const imgs = store.query<DetailImageRow>(COLLECTIONS.IMAGES, { filter: { user_id: userId }, limit: 100000 });
      for (const img of imgs) store.delete(COLLECTIONS.IMAGES, img.id);
      const products = store.query<ProductRow>(COLLECTIONS.PRODUCTS, { filter: { user_id: userId }, limit: 100000 });
      for (const p of products) store.delete(COLLECTIONS.PRODUCTS, p.id);
      return NextResponse.json({ ok: true, affected: products.length });
    }

    return NextResponse.json({ error: 'action 必须是 clear-library 或 clear-products' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
