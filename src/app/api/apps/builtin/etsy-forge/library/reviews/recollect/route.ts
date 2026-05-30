// 单商品重抓评论：走后台浏览器重新打开商品页抓评论，只更新评论不动详情图。

import { NextRequest, NextResponse } from 'next/server';
import { runReviewRecollect } from '@/lib/etsy-forge/review-recollect';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { product_id?: string };
    const productId = (body.product_id ?? '').trim();
    if (!productId) return NextResponse.json({ error: 'product_id 必填' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const settings = store.query<{ browser_context_id?: string }>(COLLECTIONS.APP_SETTINGS, { limit: 1 })[0];

    const result = await runReviewRecollect(store, {
      userId,
      productId,
      browserContextId: settings?.browser_context_id,
    });
    if (!result.ok) return NextResponse.json({ error: result.error || '重抓评论失败' }, { status: 500 });
    return NextResponse.json({ ok: true, count: result.count });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
