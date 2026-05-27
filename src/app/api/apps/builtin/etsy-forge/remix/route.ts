import { NextRequest, NextResponse } from 'next/server';
import { remixImage } from '@/lib/etsy-forge/remix';
import { getCurrentUserId, getEtsyForgeStore } from '@/lib/etsy-forge/store';
import type { RemixAction } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ACTIONS: RemixAction[] = ['recolor', 'restyle', 'resubject', 'series', 'resize', 'removebg'];

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { image_id?: string; action?: string; sessionId?: string };
    if (!body.image_id || !body.action) {
      return NextResponse.json({ error: 'image_id and action required' }, { status: 400 });
    }
    if (!VALID_ACTIONS.includes(body.action as RemixAction)) {
      return NextResponse.json(
        { error: `action must be one of ${VALID_ACTIONS.join(', ')}` },
        { status: 400 },
      );
    }

    const store = getEtsyForgeStore();
    const userId = getCurrentUserId();
    const result = await remixImage(store, {
      userId,
      sessionId: body.sessionId,
      imageId: body.image_id,
      action: body.action as RemixAction,
    });

    return NextResponse.json({
      runId: result.runId,
      action: result.action,
      succeededCount: result.succeededCount,
      failedCount: result.failedCount,
      notImplemented: result.notImplemented,
      notImplementedReason: result.notImplementedReason,
      variants: result.variants.map((v) => ({
        ok: v.ok,
        id: v.imageId,
        url: v.filePath ? `/api/media/serve?path=${encodeURIComponent(v.filePath)}` : undefined,
        error: v.error,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
