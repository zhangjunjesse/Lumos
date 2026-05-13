import { NextRequest, NextResponse } from 'next/server';

import { getDouyinCollectorStore, listKeywords } from '@/lib/douyin-collector/storage';
import {
  COLLECTION_KEYWORDS,
  CREATOR_CADENCES,
  KEYWORD_TIME_WINDOWS,
} from '@/lib/douyin-collector/constants';
import { cancelPendingJobsForTarget } from '@/lib/douyin-collector/jobs';
import type {
  CreatorCadence,
  KeywordRecord,
  KeywordTimeWindow,
} from '@/lib/douyin-collector/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const patch: Partial<KeywordRecord> = {};
    if (typeof body.query === 'string') {
      const newQuery = body.query.trim();
      if (newQuery) {
        // Renaming to clash with an existing keyword (case-insensitive)
        // would create the same dedup hole that POST avoids. Reject here
        // with 409 + existingId so UI can offer a "merge into existing"
        // affordance instead of letting two rows point at the same hashtag.
        const newLower = newQuery.toLowerCase();
        const store = getDouyinCollectorStore();
        const collision = listKeywords(store).find(
          (k) => k.id !== id && k.query.toLowerCase() === newLower,
        );
        if (collision) {
          return NextResponse.json(
            { error: `已存在同名关键词：${collision.query}`, existingId: collision.id },
            { status: 409 },
          );
        }
        patch.query = newQuery;
      }
    }
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.time_window === 'string') {
      if (!(KEYWORD_TIME_WINDOWS as readonly string[]).includes(body.time_window)) {
        return NextResponse.json({ error: 'time_window 取值非法。' }, { status: 400 });
      }
      patch.time_window = body.time_window as KeywordTimeWindow;
    }
    if (typeof body.cadence === 'string') {
      if (!(CREATOR_CADENCES as readonly string[]).includes(body.cadence)) {
        return NextResponse.json({ error: 'cadence 取值非法。' }, { status: 400 });
      }
      patch.cadence = body.cadence as CreatorCadence;
    }
    if (typeof body.dedupe_window_days === 'number' && body.dedupe_window_days > 0) {
      patch.dedupe_window_days = Math.floor(body.dedupe_window_days);
    }
    patch.updated_at = new Date().toISOString();

    const store = getDouyinCollectorStore();
    // Disabling a subscription should cancel any pending collect_jobs —
    // user toggled off to "stop everything", not "let already-buffered
    // jobs play out". Read prior state to detect the true→false edge;
    // re-saving enabled=false on already-disabled is a no-op.
    const prior = store.get<KeywordRecord>(COLLECTION_KEYWORDS, id);
    const willDisable =
      patch.enabled === false && !!prior && prior.enabled !== false;
    const updated = store.update<KeywordRecord>(COLLECTION_KEYWORDS, id, patch);
    if (!updated) return NextResponse.json({ error: '关键词不存在。' }, { status: 404 });
    let cancelledJobs = 0;
    if (willDisable) {
      cancelledJobs = cancelPendingJobsForTarget(
        'keyword',
        id,
        '关键词订阅已暂停，跳过此采集任务。',
      );
    }
    return NextResponse.json({ keyword: updated, cancelledJobs });
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
    const cancelled = cancelPendingJobsForTarget(
      'keyword',
      id,
      '关键词订阅已删除，跳过此采集任务。',
    );
    const ok = store.delete(COLLECTION_KEYWORDS, id);
    if (!ok) return NextResponse.json({ error: '关键词不存在。' }, { status: 404 });
    return NextResponse.json({ ok: true, cancelledJobs: cancelled });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
