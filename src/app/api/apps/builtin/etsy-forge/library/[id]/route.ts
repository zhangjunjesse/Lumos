import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type ImageRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = getEtsyForgeStore();
    const image = store.get<ImageRow>(COLLECTIONS.IMAGES, id);
    if (!image) return NextResponse.json({ error: 'image not found' }, { status: 404 });

    // 衍生链：所有 parent_image_id = image.id 的子图
    const derivatives = store.query<ImageRow>(COLLECTIONS.IMAGES, {
      filter: { parent_image_id: image.id },
      orderBy: { field: 'created_at', direction: 'desc' },
      limit: 100,
    });

    return NextResponse.json({
      image: {
        ...image,
        url: `/api/media/serve?path=${encodeURIComponent(image.file_path)}`,
      },
      derivatives: derivatives.map((d) => ({
        id: d.id,
        remix_action: d.remix_action,
        url: `/api/media/serve?path=${encodeURIComponent(d.file_path)}`,
        in_library: d.in_library,
        created_at: d.created_at,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const store = getEtsyForgeStore();
    const ok = store.delete(COLLECTIONS.IMAGES, id);
    return NextResponse.json({ ok });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
