// 产品开发 listing：GET 列出 / POST 新建(空白 或 从出图组导入) / PATCH 局部更新 / DELETE 删除。
// 业务逻辑在 lib/etsy-forge/listing/store.ts，本文件只做参数解析与响应。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import {
  createBlankListing,
  createListingFromMockup,
  deleteListing,
  listListings,
  updateListing,
} from '@/lib/etsy-forge/listing/store';
import type { ListingRow } from '@/lib/etsy-forge/listing/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(err: unknown) {
  return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const store = getEtsyForgeStore();
    return NextResponse.json({ listings: listListings(store, getStorageUserId(req)) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { mockupId?: string; name?: string };
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const listing = body.mockupId
      ? createListingFromMockup(store, userId, body.mockupId, body.name)
      : createBlankListing(store, userId, body.name);
    return NextResponse.json({ ok: true, listing });
  } catch (err) {
    return fail(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string; patch?: Partial<ListingRow> };
    if (!body.id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    const listing = updateListing(store, getStorageUserId(req), body.id, body.patch ?? {});
    if (!listing) return NextResponse.json({ error: '产品不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, listing });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id') ?? '';
    if (!id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    return NextResponse.json({ ok: deleteListing(store, getStorageUserId(req), id) });
  } catch (err) {
    return fail(err);
  }
}
