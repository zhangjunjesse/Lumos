import { NextRequest, NextResponse } from 'next/server';

import {
  getEcommerceStore,
} from '@/lib/ecommerce-assistant/storage';
import type { ListingFollowupRecord } from '@/lib/ecommerce-assistant/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: Record<string, unknown> | null;
  try {
    body = (await req.json()) as Record<string, unknown> | null;
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON。' }, { status: 400 });
  }
  try {
    const store = getEcommerceStore();
    const patch: Partial<ListingFollowupRecord> = {};
    if (
      body?.status === 'pending' ||
      body?.status === 'done' ||
      body?.status === 'skipped'
    ) {
      patch.status = body.status;
      if (body.status === 'done' || body.status === 'skipped') {
        patch.done_at = new Date().toISOString();
      } else {
        patch.done_at = null;
      }
    }
    if (typeof body?.note === 'string') patch.note = body.note || null;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: '没有可保存的字段。' }, { status: 400 });
    }
    const updated = store.update<ListingFollowupRecord>('listing_followups', id, patch);
    if (!updated) return NextResponse.json({ error: '清单项不存在。' }, { status: 404 });
    return NextResponse.json({ followup: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
