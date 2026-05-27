import { NextRequest, NextResponse } from 'next/server';
import { recordSignal } from '@/lib/etsy-forge/taste-profile';
import { getCurrentUserId, getEtsyForgeStore } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type ImageRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { image_id?: string; signal?: 1 | -1 };
    if (!body.image_id || (body.signal !== 1 && body.signal !== -1)) {
      return NextResponse.json(
        { error: 'image_id (string) and signal (1 or -1) required' },
        { status: 400 },
      );
    }

    const store = getEtsyForgeStore();
    const userId = getCurrentUserId();
    const image = store.get<ImageRow>(COLLECTIONS.IMAGES, body.image_id);
    if (!image) return NextResponse.json({ error: 'image not found' }, { status: 404 });

    // 👍 进图库 / 👎 不进图库
    if (body.signal === 1 && !image.in_library) {
      store.update<ImageRow>(COLLECTIONS.IMAGES, image.id, { in_library: true });
    }

    const result = recordSignal(store, userId, image.id, body.signal, {
      theme: image.theme,
      style: image.style,
      palette: image.palette,
    });

    return NextResponse.json({
      ok: true,
      in_library: body.signal === 1,
      profile_recomputed: result.profile_recomputed,
      total_signals: result.total_signals,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
