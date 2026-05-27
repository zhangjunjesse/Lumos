import { NextRequest, NextResponse } from 'next/server';
import { createPushBatch } from '@/lib/etsy-forge/image-batch';
import { getCurrentUserId, getEtsyForgeStore } from '@/lib/etsy-forge/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { size?: number; sessionId?: string };
    const size = typeof body.size === 'number' && body.size > 0 && body.size <= 100 ? Math.floor(body.size) : undefined;

    const store = getEtsyForgeStore();
    const userId = getCurrentUserId();
    const result = await createPushBatch(store, { userId, sessionId: body.sessionId, size });

    return NextResponse.json({
      batchId: result.batchId,
      runId: result.runId,
      succeededCount: result.succeededCount,
      failedCount: result.failedCount,
      quotaSpent: result.quotaSpent,
      strategy: result.strategy,
      themesUsed: result.themesUsed,
      signalsStatus: result.signalsStatus,
      images: result.results
        .filter((r) => r.ok)
        .map((r) => ({
          id: r.imageId,
          filePath: r.filePath,
          url: r.filePath ? `/api/media/serve?path=${encodeURIComponent(r.filePath)}` : undefined,
          theme: r.slot.theme,
          style: r.slot.style,
          palette: r.slot.palette,
        })),
      failures: result.results
        .filter((r) => !r.ok)
        .map((r) => ({ theme: r.slot.theme, error: r.error })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
