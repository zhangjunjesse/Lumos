import { NextRequest, NextResponse } from 'next/server';

import { COLLECTION_VIDEOS } from '@/lib/douyin-collector/constants';
import { getDouyinCollectorStore } from '@/lib/douyin-collector/storage';
import { transcribeVideoFromNative } from '@/lib/douyin-collector/transcribe';
import { getDouyinCollectorSettings } from '@/lib/douyin-collector/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface VideoRow {
  id: string;
  transcript_status?: string;
  library_status?: string;
}

/**
 * POST: transcribe up to N pending videos in parallel.
 *
 * Body: { ids?: string[], scope?: 'pending' | 'failed' | 'all', limit?: number }
 * - When `ids` is provided, only those videos are processed.
 * - Otherwise scope picks the queue: pending (default) / failed / all.
 *
 * Concurrency is bounded by `settings.transcribeConcurrency`. Each transcribe
 * call writes its own honest failure reason — bulk failures are reported as
 * a count + first 3 reasons; never silenced.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      ids?: string[];
      scope?: 'pending' | 'failed' | 'all';
      limit?: number;
    };
    const settings = getDouyinCollectorSettings();
    const concurrency = Math.max(1, Math.min(8, settings.transcribeConcurrency));
    const limit = Math.max(1, Math.min(50, Number(body.limit ?? 20)));
    const store = getDouyinCollectorStore();

    let targetIds: string[];
    if (Array.isArray(body.ids) && body.ids.length > 0) {
      targetIds = body.ids.filter((v): v is string => typeof v === 'string');
    } else {
      const scope = body.scope ?? 'pending';
      const all = store.query<VideoRow>(COLLECTION_VIDEOS, {
        orderBy: { field: 'updated_at', direction: 'desc' },
        limit: 1000,
      });
      const candidates = all.filter((v) => {
        if (v.library_status === 'discarded') return false;
        if (scope === 'all') return true;
        if (scope === 'failed') return v.transcript_status === 'failed';
        // default: pending
        return v.transcript_status === 'pending';
      });
      targetIds = candidates.slice(0, limit).map((v) => v.id);
    }

    if (targetIds.length === 0) {
      return NextResponse.json({ ok: true, processed: 0, succeeded: 0, failed: 0, reasons: [] });
    }

    const queue = [...targetIds];
    const failures: string[] = [];
    let succeeded = 0;

    async function worker() {
      while (queue.length > 0) {
        const id = queue.shift();
        if (!id) return;
        try {
          const r = await transcribeVideoFromNative(id);
          if (r.ok) succeeded += 1;
          else failures.push(r.reason);
        } catch (e) {
          failures.push(e instanceof Error ? e.message : String(e));
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, targetIds.length) }, () =>
      worker(),
    );
    await Promise.all(workers);

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
