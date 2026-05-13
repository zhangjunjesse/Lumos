import { NextRequest, NextResponse } from 'next/server';

import {
  ensureBuiltinStylePresets,
  getEcommerceStore,
} from '@/lib/ecommerce-assistant/storage';
import {
  compareCandidates,
  DiscoverCompareError,
  DEFAULT_WEIGHT,
} from '@/lib/ecommerce-assistant/discover-compare';
import { EcommerceLlmUnavailableError } from '@/lib/ecommerce-assistant/llm-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

interface BodyShape {
  candidate_ids?: unknown;
  weight?: Partial<typeof DEFAULT_WEIGHT>;
}

export async function POST(req: NextRequest) {
  let body: BodyShape;
  try {
    body = (await req.json()) as BodyShape;
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON。' }, { status: 400 });
  }
  const ids = Array.isArray(body.candidate_ids)
    ? (body.candidate_ids as unknown[]).map((x) => String(x).trim()).filter(Boolean)
    : [];
  if (ids.length < 2) {
    return NextResponse.json(
      { error: '对比至少需要 2 个候选。' },
      { status: 400 },
    );
  }
  if (ids.length > 6) {
    return NextResponse.json({ error: '单次对比最多 6 个候选。' }, { status: 400 });
  }

  try {
    const store = getEcommerceStore();
    ensureBuiltinStylePresets(store);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    let outcome;
    try {
      outcome = await compareCandidates(store, ids, { weight: body.weight ?? {} } as never, ctrl.signal);
    } finally {
      clearTimeout(timer);
    }
    return NextResponse.json({
      recommended_id: outcome.recommendedId,
      summary: outcome.summary,
      notes: outcome.notes,
      next_actions: outcome.nextActions,
      weighted: outcome.weighted,
    });
  } catch (err) {
    if (err instanceof EcommerceLlmUnavailableError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    if (err instanceof DiscoverCompareError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
