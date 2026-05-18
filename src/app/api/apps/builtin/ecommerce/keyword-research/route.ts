import { NextRequest, NextResponse } from 'next/server';

import { startKeywordResearch } from '@/lib/ecommerce-assistant/keyword-research-runner';
import { getKeywordStore, listKeywordRuns } from '@/lib/ecommerce-assistant/keyword-research-storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET — list keyword-research runs (newest first; bounded payload). */
export async function GET(req: NextRequest) {
  const limitParam = new URL(req.url).searchParams.get('limit');
  const limit = limitParam
    ? Math.min(500, Math.max(1, Number(limitParam) || 0))
    : 100;
  const runs = listKeywordRuns(getKeywordStore(), limit).map((r) => ({
    id: r.id,
    status: r.status,
    stage: r.stage,
    progress: r.progress,
    category_label: r.category_label,
    summary: r.summary,
    ehunt_detected: r.ehunt_detected,
    keyword_count: r.keyword_count,
    listing_count: r.listing_count,
    error: r.error,
    created_at: r.created_at,
    completed_at: r.completed_at,
  }));
  return NextResponse.json({ runs });
}

/** POST { categoryIds: string[] } — start a keyword-research run. */
export async function POST(req: NextRequest) {
  let body: { categoryIds?: unknown };
  try {
    body = (await req.json()) as { categoryIds?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const ids = Array.isArray(body.categoryIds)
    ? body.categoryIds.map((v) => String(v))
    : [];
  try {
    const { id } = await startKeywordResearch(ids);
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
