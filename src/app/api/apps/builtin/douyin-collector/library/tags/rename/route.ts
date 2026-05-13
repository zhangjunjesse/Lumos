import { NextRequest, NextResponse } from 'next/server';

import { COLLECTION_VIDEOS } from '@/lib/douyin-collector/constants';
import { getDouyinCollectorStore } from '@/lib/douyin-collector/storage';
import { computeTagRenamePatches } from '@/lib/douyin-collector/tag-rename';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  from?: unknown;
  to?: unknown;
}

interface VideoRow {
  id: string;
  tags?: string | null;
}

const MAX_PATCH_BATCH = 5000;

/**
 * Rename / merge a tag across the whole library (case-insensitive). Used
 * by the Settings → 维护 → 标签合并 form to clean up "AI / ai / Ai" drift.
 *
 * Returns a per-row diff: how many videos were updated, plus the list
 * of changed video IDs (capped). Idempotent; second call after a clean
 * rename returns 0 updates.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const from = typeof body.from === 'string' ? body.from.trim() : '';
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    if (!from) {
      return NextResponse.json({ error: '需要提供 from（要合并的旧标签）。' }, { status: 400 });
    }
    if (from.toLowerCase() === to.toLowerCase()) {
      return NextResponse.json({ ok: true, updated: 0, changedIds: [], message: '新旧标签相同，跳过。' });
    }

    const store = getDouyinCollectorStore();
    const videos = store.query<VideoRow>(COLLECTION_VIDEOS, { limit: MAX_PATCH_BATCH });
    const patches = computeTagRenamePatches(videos, from, to);

    const now = new Date().toISOString();
    for (const p of patches) {
      store.update(COLLECTION_VIDEOS, p.id, { tags: p.nextTagsJson, updated_at: now });
    }
    return NextResponse.json({
      ok: true,
      updated: patches.length,
      changedIds: patches.slice(0, 100).map((p) => p.id),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
