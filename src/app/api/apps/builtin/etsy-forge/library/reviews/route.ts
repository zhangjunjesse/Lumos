// 列出某商品已抓的评论 + 缓存的 AI 分析结果。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type ProductRow, type ReviewRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const productId = new URL(req.url).searchParams.get('product_id') ?? '';
    if (!productId) return NextResponse.json({ error: 'product_id 必填' }, { status: 400 });

    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const product = store.get<ProductRow>(COLLECTIONS.PRODUCTS, productId);
    if (!product || product.user_id !== userId) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }

    const reviews = store.query<ReviewRow>(COLLECTIONS.REVIEWS, {
      filter: { product_id: productId },
      orderBy: { field: 'created_at', direction: 'desc' },
      limit: 5000,
    });

    return NextResponse.json({
      productId,
      title: product.title,
      reviews: reviews.map((r) => ({
        id: r.id,
        author: r.author ?? null,
        rating: r.rating ?? null,
        date: r.date ?? null,
        region: r.region ?? null,
        text: r.text,
      })),
      analysis: product.review_analysis ?? null,
      analyzedAt: product.review_analyzed_at ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
