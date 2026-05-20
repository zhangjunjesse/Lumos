import { NextRequest, NextResponse } from 'next/server';

import {
  getEcommerceStore,
  listCandidates,
  ensureBuiltinStylePresets,
} from '@/lib/ecommerce-assistant/storage';
import { listSelectionEvidence } from '@/lib/ecommerce-assistant/discover-evidence-storage';
import {
  startDiscoverResearch,
  DiscoverResearchError,
  DiscoverNoLiveDataError,
} from '@/lib/ecommerce-assistant/discover';
import { EcommerceLlmUnavailableError } from '@/lib/ecommerce-assistant/llm-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const store = getEcommerceStore();
    ensureBuiltinStylePresets(store);
    const url = new URL(req.url);
    const researchId = url.searchParams.get('research_id');
    const filter = researchId ? { research_id: researchId } : undefined;
    const candidates = listCandidates(store, filter);
    const selection_evidence = listSelectionEvidence(store, filter);
    return NextResponse.json({ candidates, selection_evidence });
  } catch (err) {
    return errorResponse(err, 500);
  }
}

export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON。' }, { status: 400 });
  }
  const body = payload as Record<string, unknown> | null;
  const keyword = String(body?.keyword ?? '').trim();
  const market = String(body?.market ?? '').trim();
  const priceBand =
    typeof body?.price_band === 'string' && body.price_band.trim()
      ? body.price_band.trim()
      : null;
  const strategy =
    typeof body?.strategy === 'string' && body.strategy.trim()
      ? body.strategy.trim()
      : null;
  const platformFocus = Array.isArray(body?.platform_focus)
    ? (body!.platform_focus as unknown[])
        .map((x) => String(x).trim())
        .filter((x) => x.length > 0)
    : [];
  const count = Number.isFinite(body?.count) ? Number(body!.count) : undefined;
  const sampleCount = Number.isFinite(body?.sample_count)
    ? Number(body!.sample_count)
    : undefined;
  const hotSellingOnly = body?.hot_selling_only === true;

  if (!keyword) {
    return NextResponse.json({ error: '关键词不能为空。' }, { status: 400 });
  }
  if (!market) {
    return NextResponse.json({ error: '目标市场不能为空。' }, { status: 400 });
  }
  if (count != null && (count < 1 || count > 10)) {
    return NextResponse.json({ error: '候选数必须在 1-10 之间。' }, { status: 400 });
  }
  if (sampleCount != null && (sampleCount < 3 || sampleCount > 30)) {
    return NextResponse.json({ error: '采集商品数必须在 3-30 之间。' }, { status: 400 });
  }

  try {
    const store = getEcommerceStore();
    ensureBuiltinStylePresets(store);
    const outcome = startDiscoverResearch(store, {
      keyword,
      market,
      priceBand,
      platformFocus,
      strategy,
      count,
      sampleCount,
      hotSellingOnly,
    });
    return NextResponse.json({
      research_id: outcome.researchId,
      candidates: [outcome.placeholder],
      status: 'started',
    }, { status: 202 });
  } catch (err) {
    if (err instanceof EcommerceLlmUnavailableError) {
      return errorResponse(err, 503);
    }
    if (err instanceof DiscoverNoLiveDataError) {
      // 422 Unprocessable Entity: input was syntactically valid but the
      // policy refused to produce candidates (no live data available).
      return NextResponse.json(
        {
          error: err.message,
          code: 'no-live-data',
          attempts: err.attempts,
        },
        { status: 422 },
      );
    }
    if (err instanceof DiscoverResearchError) {
      return errorResponse(err, 502);
    }
    return errorResponse(err, 500);
  }
}

function errorResponse(err: unknown, status: number): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status });
}
