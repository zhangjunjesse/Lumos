// 素材库列表：按类别(scene/model/product)列出生成的素材。本地图经 /api/media/serve 显示。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type AssetRow, type CutoutRow, type DetailImageRow, type ProductRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const category = new URL(req.url).searchParams.get('category') ?? undefined;
    const store = getEtsyForgeStore();
    const filter: Record<string, unknown> = { user_id: getStorageUserId(req) };
    if (category) filter.category = category;
    const rows = store.query<AssetRow>(COLLECTIONS.ASSETS, {
      filter,
      orderBy: { field: 'created_at', direction: 'desc' },
      limit: 2000,
    });
    // 来源追溯：商品标题 + 来源原图 url（建 map 避免 N+1）
    const userId = getStorageUserId(req);
    const productTitle = new Map(
      store
        .query<ProductRow>(COLLECTIONS.PRODUCTS, { filter: { user_id: userId }, limit: 5000 })
        .map((p) => [p.id, p.title]),
    );
    const imageUrl = new Map(
      store
        .query<DetailImageRow>(COLLECTIONS.IMAGES, { filter: { user_id: userId }, limit: 20000 })
        .map((im) => [im.id, im.image_url]),
    );
    const assetItems = rows.map((r) => ({
      id: r.id,
      category: r.category as string,
      description: r.description ?? '',
      url: r.image_path ? `/api/media/serve?path=${encodeURIComponent(r.image_path)}` : null,
      path: r.image_path ?? null,
      status: r.status,
      failure_reason: r.failure_reason ?? null,
      source_product_id: r.product_id ?? null,
      source_product_title: r.product_id ? (productTitle.get(r.product_id) ?? null) : null,
      source_image_urls: Array.isArray(r.source_image_ids)
        ? r.source_image_ids.map((id) => imageUrl.get(id)).filter((u): u is string => !!u)
        : [],
      quality_flag: (r.quality_flag as 'good' | 'weak' | undefined) ?? null,
      quality_note: (r.quality_note as string | undefined) ?? null,
      series_of: (r.series_of as string | undefined) ?? null,
      created_at: (r.created_at as string) ?? '',
    }));

    // 印花(design)：抠印花结果(CUTOUTS，成功的)作为素材库的一类一起展示。
    // 不存进 assets 表——删除/重抠在图库「查看抠图」管，这里只读。category=design 时只返回印花。
    const designItems =
      !category || category === 'design'
        ? store
            .query<CutoutRow>(COLLECTIONS.CUTOUTS, {
              filter: { user_id: userId, status: 'success' },
              orderBy: { field: 'created_at', direction: 'desc' },
              limit: 2000,
            })
            .map((c) => ({
              id: c.id,
              category: 'design',
              description: '',
              url: c.cutout_path ? `/api/media/serve?path=${encodeURIComponent(c.cutout_path)}` : null,
              path: c.cutout_path ?? null,
              status: c.status,
              failure_reason: c.failure_reason ?? null,
              source_product_id: c.product_id ?? null,
              source_product_title: c.product_id ? (productTitle.get(c.product_id) ?? null) : null,
              source_image_urls: [] as string[],
              quality_flag: null,
              quality_note: null,
              series_of: null,
              created_at: (c.created_at as string) ?? '',
            }))
        : [];

    return NextResponse.json({ assets: [...designItems, ...assetItems] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    const row = store.get<AssetRow>(COLLECTIONS.ASSETS, id);
    if (!row || row.user_id !== getStorageUserId(req)) {
      return NextResponse.json({ error: '素材不存在' }, { status: 404 });
    }
    return NextResponse.json({ ok: store.delete(COLLECTIONS.ASSETS, id) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
