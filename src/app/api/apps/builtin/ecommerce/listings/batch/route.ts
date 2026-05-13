import { NextRequest, NextResponse } from 'next/server';

import {
  ensureBuiltinStylePresets,
  getEcommerceStore,
} from '@/lib/ecommerce-assistant/storage';
import {
  draftListingForInput,
  ListingDrafterError,
} from '@/lib/ecommerce-assistant/listing-drafter';
import { EcommerceLlmUnavailableError } from '@/lib/ecommerce-assistant/llm-client';
import type { ListingPlatform } from '@/lib/ecommerce-assistant/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// many platforms × many languages can stack up; allow ample budget
export const maxDuration = 300;

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

const PLATFORM_LIMIT = 6;
const LANGUAGE_LIMIT = 4;

interface BatchTask {
  platform: ListingPlatform;
  language: string;
}

interface BatchOutcome {
  platform: ListingPlatform;
  language: string;
  ok: boolean;
  draft_id?: string;
  error?: string;
}

/**
 * Draft listings across multiple (platform × language) combos for one input.
 * Runs sequentially (not parallel) to respect LLM rate limits and to keep
 * the per-request cost predictable.
 */
export async function POST(req: NextRequest) {
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON。' }, { status: 400 });
  }
  const body = payload as Record<string, unknown> | null;
  const inputId = String(body?.input_id ?? '').trim();
  const platforms = Array.isArray(body?.platforms)
    ? (body!.platforms as unknown[])
        .map((p) => String(p).trim())
        .filter((p): p is ListingPlatform => ALLOWED_PLATFORMS.includes(p as ListingPlatform))
    : [];
  const languages = Array.isArray(body?.languages)
    ? (body!.languages as unknown[]).map((l) => String(l).trim()).filter(Boolean)
    : [];

  if (!inputId) {
    return NextResponse.json({ error: 'input_id 不能为空。' }, { status: 400 });
  }
  if (platforms.length === 0) {
    return NextResponse.json(
      { error: '至少选 1 个平台（platforms 数组不能为空）。' },
      { status: 400 },
    );
  }
  if (languages.length === 0) {
    return NextResponse.json(
      { error: '至少选 1 种语言（languages 数组不能为空）。' },
      { status: 400 },
    );
  }
  if (platforms.length > PLATFORM_LIMIT) {
    return NextResponse.json(
      { error: `单次最多 ${PLATFORM_LIMIT} 个平台。` },
      { status: 400 },
    );
  }
  if (languages.length > LANGUAGE_LIMIT) {
    return NextResponse.json(
      { error: `单次最多 ${LANGUAGE_LIMIT} 种语言。` },
      { status: 400 },
    );
  }

  const tasks: BatchTask[] = [];
  for (const p of platforms) {
    for (const l of languages) tasks.push({ platform: p, language: l });
  }

  const store = getEcommerceStore();
  ensureBuiltinStylePresets(store);
  const outcomes: BatchOutcome[] = [];
  let llmUnavailable = false;

  for (const task of tasks) {
    if (llmUnavailable) {
      outcomes.push({
        ...task,
        ok: false,
        error: '前一项触发 LLM 不可用，剩余任务全部跳过。',
      });
      continue;
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      let outcome;
      try {
        outcome = await draftListingForInput(
          store,
          { inputId, platform: task.platform, language: task.language },
          ctrl.signal,
        );
      } finally {
        clearTimeout(timer);
      }
      outcomes.push({ ...task, ok: true, draft_id: outcome.draft.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcomes.push({ ...task, ok: false, error: message });
      if (err instanceof EcommerceLlmUnavailableError) {
        llmUnavailable = true;
      }
      if (err instanceof ListingDrafterError && /商品输入不存在/.test(message)) {
        // Don't bother retrying for missing input; abort batch.
        return NextResponse.json(
          { outcomes, error: message },
          { status: 400 },
        );
      }
    }
  }

  const successCount = outcomes.filter((o) => o.ok).length;
  return NextResponse.json({
    requested: tasks.length,
    succeeded: successCount,
    failed: tasks.length - successCount,
    outcomes,
  });
}
