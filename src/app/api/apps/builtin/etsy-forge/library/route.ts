import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type ImageRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const tab = url.searchParams.get('tab') ?? 'all';
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 100)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));

    const filter: Record<string, unknown> = { in_library: true };
    if (tab === 'generated') filter.source_type = 'generated';
    if (tab === 'remixed') filter.source_type = 'remixed';

    const store = getEtsyForgeStore();
    const total = store.count(COLLECTIONS.IMAGES, filter);
    const rows = store.query<ImageRow>(COLLECTIONS.IMAGES, {
      filter,
      orderBy: { field: 'created_at', direction: 'desc' },
      limit,
      offset,
    });

    return NextResponse.json({
      total,
      tab,
      images: rows.map((r) => ({
        id: r.id,
        source_type: r.source_type,
        parent_image_id: r.parent_image_id,
        remix_action: r.remix_action || undefined,
        theme: r.theme,
        style: r.style,
        palette: r.palette,
        file_path: r.file_path,
        url: `/api/media/serve?path=${encodeURIComponent(r.file_path)}`,
        created_at: r.created_at,
        ai_generated_tag: r.ai_generated_tag,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
