import { NextRequest, NextResponse } from 'next/server';

import {
  ensureBuiltinStylePresets,
  getEcommerceStore,
} from '@/lib/ecommerce-assistant/storage';
import {
  compareListings,
  ListingCompareError,
} from '@/lib/ecommerce-assistant/listing-compare';
import { EcommerceLlmUnavailableError } from '@/lib/ecommerce-assistant/llm-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  let body: { draft_ids?: unknown };
  try {
    body = (await req.json()) as { draft_ids?: unknown };
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON。' }, { status: 400 });
  }
  const ids = Array.isArray(body.draft_ids)
    ? (body.draft_ids as unknown[]).map((x) => String(x).trim()).filter(Boolean)
    : [];
  if (ids.length < 2) {
    return NextResponse.json({ error: '对比至少需要 2 个草稿。' }, { status: 400 });
  }
  if (ids.length > 5) {
    return NextResponse.json({ error: '单次对比最多 5 个草稿。' }, { status: 400 });
  }

  try {
    const store = getEcommerceStore();
    ensureBuiltinStylePresets(store);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    let outcome;
    try {
      outcome = await compareListings(store, ids, ctrl.signal);
    } finally {
      clearTimeout(timer);
    }
    return NextResponse.json({
      recommended_id: outcome.recommendedId,
      summary: outcome.summary,
      evaluations: outcome.evaluations,
      cross_cutting_issues: outcome.crossCuttingIssues,
    });
  } catch (err) {
    if (err instanceof EcommerceLlmUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof ListingCompareError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
