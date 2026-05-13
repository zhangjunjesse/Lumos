import { NextRequest, NextResponse } from 'next/server';

import {
  getDouyinCollectorStore,
  listKeywords,
} from '@/lib/douyin-collector/storage';
import {
  COLLECTION_KEYWORDS,
  CREATOR_CADENCES,
  KEYWORD_TIME_WINDOWS,
} from '@/lib/douyin-collector/constants';
import { cleanKeywordQuery } from '@/lib/douyin-collector/parsers';
import type {
  CreatorCadence,
  KeywordRecord,
  KeywordTimeWindow,
} from '@/lib/douyin-collector/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ items: listKeywords() });
  } catch (err) {
    return errorResponse(err, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    // Strip leading `#` so single-token queries store the canonical form
    // (matches the hashtag scrape input + the seeded tag value).
    const rawQuery = typeof body.query === 'string' ? body.query : '';
    const query = cleanKeywordQuery(rawQuery);
    if (!query) {
      return NextResponse.json({ error: '关键词不能为空。' }, { status: 400 });
    }
    const timeWindow = normalizeTimeWindow(body.time_window);
    const cadence = normalizeCadence(body.cadence);
    const dedupeRaw = Number(body.dedupe_window_days);
    const dedupe = Number.isFinite(dedupeRaw) && dedupeRaw > 0 ? Math.floor(dedupeRaw) : 30;

    const now = new Date().toISOString();
    const store = getDouyinCollectorStore();

    // Dedup: case-insensitive match on the cleaned query. "AI" and "ai"
    // are the same hashtag on douyin; allowing both creates duplicate
    // patrol jobs and clutters the keyword list. 409 with existing id so
    // UI can route the user to the row that's already there.
    const queryLower = query.toLowerCase();
    const existing = listKeywords(store).find(
      (k) => k.query.toLowerCase() === queryLower,
    );
    if (existing) {
      return NextResponse.json(
        {
          error: `该关键词已订阅：${existing.query}`,
          existingId: existing.id,
        },
        { status: 409 },
      );
    }

    const created = store.create<KeywordRecord>(COLLECTION_KEYWORDS, {
      query,
      time_window: timeWindow,
      dedupe_window_days: dedupe,
      cadence,
      last_checked_at: null,
      enabled: true,
      updated_at: now,
    });
    return NextResponse.json({ keyword: created });
  } catch (err) {
    return errorResponse(err, 400);
  }
}

function normalizeTimeWindow(value: unknown): KeywordTimeWindow {
  if (typeof value === 'string' && (KEYWORD_TIME_WINDOWS as readonly string[]).includes(value)) {
    return value as KeywordTimeWindow;
  }
  return 'week';
}

function normalizeCadence(value: unknown): CreatorCadence {
  if (typeof value === 'string' && (CREATOR_CADENCES as readonly string[]).includes(value)) {
    return value as CreatorCadence;
  }
  return 'manual';
}

function errorResponse(err: unknown, fallbackStatus: number): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status: fallbackStatus });
}
