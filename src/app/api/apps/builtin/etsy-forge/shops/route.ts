// 关注的店铺:GET 列表(基本信息/装修/EHunt 状态)+ DELETE 删一条。装修图统一转 /api/media/serve。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { recollectShopById } from '@/lib/etsy-forge/shop-collect';
import { COLLECTIONS, type ShopRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const serve = (p?: string): string | null => (p ? `/api/media/serve?path=${encodeURIComponent(p)}` : null);

export async function GET(req: NextRequest) {
  try {
    const store = getEtsyForgeStore();
    const rows = store.query<ShopRow>(COLLECTIONS.SHOPS, {
      filter: { user_id: getStorageUserId(req) },
      orderBy: { field: 'created_at', direction: 'desc' },
      limit: 500,
    });
    return NextResponse.json({
      total: rows.length,
      shops: rows.map((s) => ({
        id: s.id,
        shop_name: s.shop_name,
        url: s.url,
        avatar_url: s.avatar_url ?? null,
        location: s.location ?? null,
        total_sales: s.total_sales ?? null,
        review_count: s.review_count ?? null,
        review_rating: s.review_rating ?? null,
        since_year: s.since_year ?? null,
        announcement: s.announcement ?? null,
        banner: serve(s.banner_path),
        rep_listings: (s.rep_listing_paths ?? []).map((p) => serve(p)).filter((u): u is string => !!u),
        screenshot: serve(s.homepage_screenshot_path),
        ehunt_status: s.ehunt_status,
        ehunt: s.ehunt_json ? safeParse(s.ehunt_json) : null,
        ehunt_bar: serve(s.ehunt_bar_path),
        collect_status: s.collect_status,
        failure_reason: s.failure_reason ?? null,
        product_count: (s.source_product_ids ?? []).length,
        collected_at: s.collected_at ?? null,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

// 重采:按已存 shop.url 重新采(同步等结果,~10-20s)。驱动 AdsPower 自动化浏览器,不动用户可见页。
export async function POST(req: NextRequest) {
  try {
    const { id } = (await req.json()) as { id?: string };
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    const r = await recollectShopById(getEtsyForgeStore(), getStorageUserId(req), id);
    if (!r.ok) return NextResponse.json({ error: r.error || '重采失败' }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    getEtsyForgeStore().delete(COLLECTIONS.SHOPS, id);
    return NextResponse.json({ ok: true });
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
