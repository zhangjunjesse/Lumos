// 商品列表（第一步采集结果）。GET 列表 + PATCH 批量勾选/取消。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type ProductRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const keyword = url.searchParams.get('keyword') ?? undefined;
    const onlySelected = url.searchParams.get('selected') === '1';
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 200)));

    const store = getEtsyForgeStore();
    const filter: Record<string, unknown> = { user_id: getStorageUserId(req) };
    if (keyword) filter.keyword = keyword;
    if (onlySelected) filter.selected = true;

    const rows = store.query<ProductRow>(COLLECTIONS.PRODUCTS, {
      filter,
      orderBy: { field: 'created_at', direction: 'desc' },
      limit,
    });

    return NextResponse.json({
      total: rows.length,
      products: rows.map((p) => ({
        id: p.id,
        listing_id: p.listing_id,
        keyword: p.keyword,
        title: p.title,
        url: p.url,
        main_image_url: p.main_image_url,
        price: p.price,
        ehunt_status: p.ehunt_status,
        ehunt: p.ehunt_json ? safeParse(p.ehunt_json) : null,
        selected: p.selected,
        detail_status: p.detail_status,
        detail_image_count: p.detail_image_count,
        detail_failure_reason: p.detail_failure_reason,
        created_at: p.created_at,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { ids?: string[]; selected?: boolean };
    if (!Array.isArray(body.ids) || typeof body.selected !== 'boolean') {
      return NextResponse.json({ error: 'ids[] 和 selected(bool) 必填' }, { status: 400 });
    }
    const store = getEtsyForgeStore();
    let updated = 0;
    for (const id of body.ids) {
      if (store.update<ProductRow>(COLLECTIONS.PRODUCTS, id, { selected: body.selected })) updated++;
    }
    return NextResponse.json({ ok: true, updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
