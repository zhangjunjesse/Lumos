// 批量删除图库内容：删商品（连带其详情图）/ 删单张详情图。前端二次确认才调。

import { NextRequest, NextResponse } from 'next/server';
import { deleteLibraryEntities } from '@/lib/etsy-forge/library-manage';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { product_ids?: string[]; image_ids?: string[] };
    const productIds = Array.isArray(body.product_ids) ? body.product_ids.filter((x) => typeof x === 'string') : [];
    const imageIds = Array.isArray(body.image_ids) ? body.image_ids.filter((x) => typeof x === 'string') : [];
    if (productIds.length === 0 && imageIds.length === 0) {
      return NextResponse.json({ error: 'product_ids 或 image_ids 至少一个' }, { status: 400 });
    }

    const store = getEtsyForgeStore();
    const result = deleteLibraryEntities(store, getStorageUserId(req), { productIds, imageIds });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
