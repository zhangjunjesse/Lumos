// 对选中商品的详情图抠图（去背景）。默认全图，image_ids 指定时只抠选中的。同步等结果。

import { NextRequest, NextResponse } from 'next/server';
import { runCutout } from '@/lib/etsy-forge/cutout-collect';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { product_ids?: string[]; image_ids?: string[]; prompt?: string };
    const productIds = Array.isArray(body.product_ids) ? body.product_ids.filter((x) => typeof x === 'string') : [];
    const imageIds = Array.isArray(body.image_ids) ? body.image_ids.filter((x) => typeof x === 'string') : undefined;
    const prompt = typeof body.prompt === 'string' ? body.prompt : undefined;
    if (productIds.length === 0) {
      return NextResponse.json({ error: 'product_ids 必填' }, { status: 400 });
    }

    const store = getEtsyForgeStore();
    const result = await runCutout(store, { userId: getStorageUserId(req), productIds, imageIds, prompt });
    if (result.error) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
