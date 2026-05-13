import { NextRequest, NextResponse } from 'next/server';

import {
  cascadeDeleteVideoChildren,
  getDouyinCollectorStore,
} from '@/lib/douyin-collector/storage';
import { COLLECTION_VIDEOS } from '@/lib/douyin-collector/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_LIBRARY_STATUS = ['unprocessed', 'draft', 'published', 'discarded'] as const;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const store = getDouyinCollectorStore();
    const video = store.get(COLLECTION_VIDEOS, id);
    if (!video) return NextResponse.json({ error: '视频不存在。' }, { status: 404 });
    return NextResponse.json({ video });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.summary === 'string') patch.summary = body.summary;
    if (typeof body.notes === 'string') patch.notes = body.notes;
    if (typeof body.starred === 'boolean') patch.starred = body.starred;
    if (Array.isArray(body.tags)) patch.tags = JSON.stringify(body.tags);
    if (typeof body.tags === 'string') patch.tags = body.tags;
    if (typeof body.library_status === 'string') {
      if (!(ALLOWED_LIBRARY_STATUS as readonly string[]).includes(body.library_status)) {
        return NextResponse.json({ error: 'library_status 取值非法。' }, { status: 400 });
      }
      patch.library_status = body.library_status;
    }
    if (typeof body.library_collection_id === 'string') {
      patch.library_collection_id = body.library_collection_id;
    }

    const store = getDouyinCollectorStore();
    const updated = store.update(COLLECTION_VIDEOS, id, patch);
    if (!updated) return NextResponse.json({ error: '视频不存在。' }, { status: 404 });
    return NextResponse.json({ video: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const store = getDouyinCollectorStore();
    // Cascade-clean dependent rows first so we don't leave orphan
    // transcripts (1:1 with video) or stale library_links pointing at
    // a deleted video. kb_items themselves stay — those are curated
    // content in the user's knowledge library, not derivable.
    const cascaded = cascadeDeleteVideoChildren(id, store);
    const ok = store.delete(COLLECTION_VIDEOS, id);
    if (!ok) return NextResponse.json({ error: '视频不存在。' }, { status: 404 });
    return NextResponse.json({ ok: true, cascaded });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
