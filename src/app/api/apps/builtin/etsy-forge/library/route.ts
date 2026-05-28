// 图库 = 采集到的详情图。GET 列表（可按 keyword / product_id 过滤）。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type DetailImageRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const keyword = url.searchParams.get('keyword') ?? undefined;
    const productId = url.searchParams.get('product_id') ?? undefined;
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') ?? 300)));

    const store = getEtsyForgeStore();
    const filter: Record<string, unknown> = { user_id: getStorageUserId(req) };
    if (keyword) filter.keyword = keyword;
    if (productId) filter.product_id = productId;

    const rows = store.query<DetailImageRow>(COLLECTIONS.IMAGES, {
      filter,
      orderBy: { field: 'created_at', direction: 'desc' },
      limit,
    });

    return NextResponse.json({
      total: rows.length,
      images: rows.map((r) => ({
        id: r.id,
        product_id: r.product_id,
        listing_id: r.listing_id,
        keyword: r.keyword,
        url: r.image_url,
        is_main: r.is_main,
        position: r.position,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
