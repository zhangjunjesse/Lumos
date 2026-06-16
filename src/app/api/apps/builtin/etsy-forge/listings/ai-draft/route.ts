// 产品开发 — AI 文案草稿(R2)。POST {id, hint?} → 看本产品自有主图 + 选品情报生成草稿，
// 落 listing.copy_draft 暂存(不写正式字段)。失败如实返回原因，不 mock。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { generateCopyDraft } from '@/lib/etsy-forge/listing/ai-draft';
import { getListing, updateListing } from '@/lib/etsy-forge/listing/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string; hint?: string };
    if (!body.id) return NextResponse.json({ error: 'id 必填' }, { status: 400 });
    const store = getEtsyForgeStore();
    const userId = getStorageUserId(req);
    const listing = getListing(store, userId, body.id);
    if (!listing) return NextResponse.json({ error: '产品不存在' }, { status: 404 });

    const draft = await generateCopyDraft(store, userId, listing, body.hint ?? '');
    const updated = updateListing(store, userId, body.id, { copy_draft: draft });
    return NextResponse.json({ ok: true, draft, listing: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
