import { NextRequest, NextResponse } from 'next/server';

import { COLLECTION_VIDEOS } from '@/lib/douyin-collector/constants';
import { getDouyinCollectorStore } from '@/lib/douyin-collector/storage';
import { summarizeVideo } from '@/lib/douyin-collector/ai-summary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface VideoRow {
  id: string;
  transcript_status?: string;
  library_status?: string;
  summary?: string | null;
}

/**
 * Bulk-summarize: for every video that has a transcript and no summary yet
 * (or scope=all), call the AI summary path. Sequential — LLM calls are
 * heavier than ASR and we want to avoid burning provider quota on a
 * runaway parallel sweep. Reports counts + first 3 distinct failure
 * reasons.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      ids?: string[];
      scope?: 'missing' | 'all';
      limit?: number;
    };
    const limit = Math.max(1, Math.min(50, Number(body.limit ?? 10)));
    const store = getDouyinCollectorStore();

    let targetIds: string[];
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      targetIds = body.ids.filter((v): v is string => typeof v === 'string');
    } else {
      const scope = body.scope ?? 'missing';
      const all = store.query<VideoRow>(COLLECTION_VIDEOS, {
        orderBy: { field: 'updated_at', direction: 'desc' },
        limit: 1000,
      });
      const candidates = all.filter((v) => {
        if (v.library_status === 'discarded') return false;
        if (v.transcript_status !== 'success') return false;
        if (scope === 'missing' && v.summary && v.summary.trim()) return false;
        return true;
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
        const r = await summarizeVideo(id);
        if (r.ok) succeeded += 1;
        else failures.push(r.reason);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
      }
    }

    return NextResponse.json({
      // ok=true ⟺ every target succeeded. Pre-Round-157 hardcoded
      // ok=true even when half failed, so the UI showed a green "成功"
      // toast for "5 succeeded · 5 failed". Now ok mirrors reality:
      // partial/total failure → ok=false; client styles the toast
      // accordingly while still rendering the breakdown.
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
