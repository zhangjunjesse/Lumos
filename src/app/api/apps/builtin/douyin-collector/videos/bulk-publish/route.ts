import { NextRequest, NextResponse } from 'next/server';

import { COLLECTION_VIDEOS } from '@/lib/douyin-collector/constants';
import { getDouyinCollectorStore } from '@/lib/douyin-collector/storage';
import { publishVideoToKnowledge } from '@/lib/douyin-collector/publish';
import { getDouyinCollectorSettings } from '@/lib/douyin-collector/settings';
import { isKnowledgeItemReadyForLibrary } from '@/lib/douyin-collector/knowledge-readiness';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface VideoRow {
  id: string;
  aweme_id?: string;
  transcript_status?: string;
  library_status?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      ids?: string[];
      scope?: 'draft' | 'unprocessed' | 'all';
      collectionId?: string;
      limit?: number;
    };
    const explicit = typeof body.collectionId === 'string' ? body.collectionId.trim() : '';
    const fallback = (getDouyinCollectorSettings().libraryCollectionId ?? '').trim();
    const collectionId = explicit || fallback;
    if (!collectionId) {
      return NextResponse.json(
        { ok: false, error: '未指定 knowledge collection；请先到「设置 → 入库目标」选一个。' },
        { status: 400 },
      );
    }

    const limit = Math.max(1, Math.min(100, Number(body.limit ?? 30)));
    const store = getDouyinCollectorStore();

    let targetIds: string[];
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      targetIds = body.ids.filter((v): v is string => typeof v === 'string');
    } else {
      const scope = body.scope ?? 'draft';
      const all = store.query<VideoRow>(COLLECTION_VIDEOS, {
        orderBy: { field: 'updated_at', direction: 'desc' },
        limit: 1000,
      });
      const candidates = all.filter((v) => {
        if (v.transcript_status !== 'success') return false;
        if (v.library_status === 'discarded') return false;
        const needsLibraryRepair =
          v.library_status === 'published' && !isVideoReadyInCollection(v, collectionId);
        if (scope === 'draft') {
          return (
            needsLibraryRepair ||
            v.library_status === 'draft' ||
            !v.library_status ||
            v.library_status === 'unprocessed'
          );
        }
        if (scope === 'unprocessed') return !v.library_status || v.library_status === 'unprocessed';
        return scope === 'all' || needsLibraryRepair;
      });
      targetIds = candidates.slice(0, limit).map((v) => v.id);
    }

    if (targetIds.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, succeeded: 0, failed: 0, reasons: [] });
    }

    const failures: string[] = [];
    let succeeded = 0;
    for (const id of targetIds) {
      try {
        const r = await publishVideoToKnowledge(id, collectionId);
        if (r.ok) succeeded += 1;
        else failures.push(r.reason);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
      }
    }

    return NextResponse.json({
      // ok=true ⟺ every target succeeded — see Round 157 contract.
      ok: failures.length === 0,
      processed: targetIds.length,
      succeeded,
      failed: failures.length,
      reasons: Array.from(new Set(failures)).slice(0, 3),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

function isVideoReadyInCollection(video: VideoRow, collectionId: string): boolean {
  try {
    const sourceKey = `douyin:${video.aweme_id || video.id}`;
    const row = getDb()
      .prepare(
        `SELECT processing_status, chunk_count, processing_detail, summary, key_points, tags
         FROM kb_items
         WHERE collection_id = ? AND source_key = ?
         LIMIT 1`,
      )
      .get(collectionId, sourceKey) as
      | {
          processing_status?: string;
          chunk_count?: number | null;
          processing_detail?: string | null;
          summary?: string | null;
          key_points?: string | null;
          tags?: string | null;
        }
      | undefined;
    return isKnowledgeItemReadyForLibrary(row);
  } catch {
    return false;
  }
}
