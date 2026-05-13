import { NextRequest, NextResponse } from 'next/server';

import { publishVideoToKnowledge } from '@/lib/douyin-collector/publish';
import { getDouyinCollectorSettings } from '@/lib/douyin-collector/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { collectionId?: string };
    const explicit = typeof body.collectionId === 'string' ? body.collectionId : '';
    const fallback = getDouyinCollectorSettings().libraryCollectionId ?? '';
    const collectionId = (explicit || fallback).trim();
    if (!collectionId) {
      return NextResponse.json(
        {
          ok: false,
          error: '未指定 knowledge collection；请先在「设置 → 入库目标」选一个。',
        },
        { status: 400 },
      );
    }
    const result = await publishVideoToKnowledge(id, collectionId);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true, itemId: result.itemId, collectionId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
