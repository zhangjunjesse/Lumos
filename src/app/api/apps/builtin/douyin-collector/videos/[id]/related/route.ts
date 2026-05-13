import { NextRequest, NextResponse } from 'next/server';

import { findRelatedVideos } from '@/lib/douyin-collector/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(20, Number(url.searchParams.get('limit') ?? '6')));
    const items = findRelatedVideos(id, limit);
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
