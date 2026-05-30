// 给图库里的商品批量加/去标签（标签仅商品维度）。

import { NextRequest, NextResponse } from 'next/server';
import { applyProductTags } from '@/lib/etsy-forge/library-manage';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { product_ids?: string[]; add?: string[]; remove?: string[] };
    const productIds = Array.isArray(body.product_ids) ? body.product_ids.filter((x) => typeof x === 'string') : [];
    if (productIds.length === 0) {
      return NextResponse.json({ error: 'product_ids 必填' }, { status: 400 });
    }
    const add = Array.isArray(body.add) ? body.add : [];
    const remove = Array.isArray(body.remove) ? body.remove : [];
    if (add.length === 0 && remove.length === 0) {
      return NextResponse.json({ error: 'add 或 remove 至少一个' }, { status: 400 });
    }

    const store = getEtsyForgeStore();
    const updated = applyProductTags(store, getStorageUserId(req), productIds, add, remove);
    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
