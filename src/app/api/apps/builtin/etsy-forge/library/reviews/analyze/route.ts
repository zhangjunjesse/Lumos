// 跑 AI 评论分析（基于已抓评论），结果缓存到商品。前端在打开评论弹框时自动调一次。

import { NextRequest, NextResponse } from 'next/server';
import { analyzeProductReviews } from '@/lib/etsy-forge/review-analysis';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { product_id?: string };
    const productId = typeof body.product_id === 'string' ? body.product_id : '';
    if (!productId) return NextResponse.json({ error: 'product_id 必填' }, { status: 400 });

    const store = getEtsyForgeStore();
    const analysis = await analyzeProductReviews(store, getStorageUserId(req), productId);
    return NextResponse.json({ ok: true, analysis });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
