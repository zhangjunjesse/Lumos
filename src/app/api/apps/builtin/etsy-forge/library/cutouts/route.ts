// 列某商品的抠图结果（含成功/失败）。抠图本地图经 /api/media/serve 显示。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type CutoutRow, type ProductRow } from '@/lib/etsy-forge/types';

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

    const rows = store.query<CutoutRow>(COLLECTIONS.CUTOUTS, {
      filter: { product_id: productId },
      orderBy: { field: 'created_at', direction: 'desc' },
      limit: 5000,
    });

    return NextResponse.json({
      productId,
      title: product.title,
      cutouts: rows.map((r) => ({
        id: r.id,
        source_count: typeof r.source_count === 'number' ? r.source_count : 0,
        // 本地抠图图经媒体服务路由显示
        cutout_url: r.cutout_path ? `/api/media/serve?path=${encodeURIComponent(r.cutout_path)}` : null,
        status: r.status,
        failure_reason: r.failure_reason ?? null,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
