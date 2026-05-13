import { NextRequest, NextResponse } from 'next/server';

import { ingestKeywordVideos } from '@/lib/douyin-collector/keyword-ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      urls?: unknown;
      text?: unknown;
    };
    let urls: string[] = [];
    if (Array.isArray(body.urls)) {
      urls = body.urls.filter((v): v is string => typeof v === 'string');
    } else if (typeof body.text === 'string') {
      // Allow paste-a-blob: split on newline / whitespace, ignore empties.
      urls = body.text
        .split(/[\r\n\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    const r = await ingestKeywordVideos(id, urls);
    if (!r.ok && r.processed === 0) {
      // Spread first so the explicit ok=false isn't overwritten by r.ok.
      return NextResponse.json({ ...r, ok: false }, { status: 400 });
    }
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
