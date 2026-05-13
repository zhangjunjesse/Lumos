import { NextRequest, NextResponse } from 'next/server';

import {
  ensureBuiltinStylePresets,
  getEcommerceStore,
  listListingDrafts,
} from '@/lib/ecommerce-assistant/storage';
import {
  draftListingForInput,
  ListingDrafterError,
} from '@/lib/ecommerce-assistant/listing-drafter';
import { EcommerceLlmUnavailableError } from '@/lib/ecommerce-assistant/llm-client';
import { recordAuditEvent } from '@/lib/ecommerce-assistant/audit-log';
import type { ListingPlatform } from '@/lib/ecommerce-assistant/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const ALLOWED_PLATFORMS: ListingPlatform[] = [
  'amazon-us',
  'amazon-uk',
  'amazon-jp',
  'amazon-de',
  'tiktok-shop-us',
  'etsy',
  'shopify-dtc',
  'shopee-sg',
  'lazada-sg',
  'walmart',
];

export async function GET(req: NextRequest) {
  try {
    const store = getEcommerceStore();
    ensureBuiltinStylePresets(store);
    const url = new URL(req.url);
    const inputId = url.searchParams.get('input_id');
    const filter = inputId ? { input_id: inputId } : undefined;
    const drafts = listListingDrafts(store, filter);
    return NextResponse.json({ drafts });
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
  const inputId = String(body?.input_id ?? '').trim();
  const platform = String(body?.platform ?? '').trim() as ListingPlatform;
  const language = String(body?.language ?? 'en').trim();
  const count =
    typeof body?.count === 'number' && body.count >= 3 && body.count <= 10
      ? Number(body.count)
      : undefined;

  if (!inputId) {
    return NextResponse.json({ error: 'input_id 不能为空。' }, { status: 400 });
  }
  if (!ALLOWED_PLATFORMS.includes(platform)) {
    return NextResponse.json(
      { error: `不支持的 platform：${platform}` },
      { status: 400 },
    );
  }
  if (!language) {
    return NextResponse.json({ error: 'language 不能为空。' }, { status: 400 });
  }

  try {
    const store = getEcommerceStore();
    ensureBuiltinStylePresets(store);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    let outcome;
    try {
      outcome = await draftListingForInput(
        store,
        { inputId, platform, language, count },
        ctrl.signal,
      );
    } finally {
      clearTimeout(timer);
    }
    recordAuditEvent(store, {
      kind: 'listing-drafted',
      targetId: outcome.draft.id,
      targetType: 'listing',
      inputId: inputId,
      summary: `起草 listing（${platform}/${language}）`,
      payload: { platform, language, count },
    });
    return NextResponse.json({ draft: outcome.draft });
  } catch (err) {
    if (err instanceof EcommerceLlmUnavailableError) {
      return errorResponse(err, 503);
    }
    if (err instanceof ListingDrafterError) {
      return errorResponse(err, 400);
    }
    return errorResponse(err, 500);
  }
}

function errorResponse(err: unknown, status: number): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status });
}
