import { NextRequest, NextResponse } from 'next/server';

import {
  getDouyinCollectorStore,
  listCreators,
} from '@/lib/douyin-collector/storage';
import { resolveCreatorInput } from '@/lib/douyin-collector/resolve-creator-input';
import { CREATOR_CADENCES, COLLECTION_CREATORS } from '@/lib/douyin-collector/constants';
import type { CreatorCadence, CreatorRecord } from '@/lib/douyin-collector/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ items: listCreators() });
  } catch (err) {
    return errorResponse(err, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      input?: unknown;
      nickname?: unknown;
      cadence?: unknown;
    };
    const inputRaw = typeof body.input === 'string' ? body.input.trim() : '';
    const nicknameRaw = typeof body.nickname === 'string' ? body.nickname.trim() : '';
    const cadence = normalizeCadence(body.cadence);

    if (!inputRaw) {
      return NextResponse.json(
        { error: '需要输入博主主页链接或 sec_uid。' },
        { status: 400 },
      );
    }

    const outcome = await resolveCreatorInput(inputRaw);
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.message }, { status: 400 });
    }
    const secUid = outcome.secUid;

    const nickname = nicknameRaw || `博主 ${secUid.slice(0, 8)}…`;
    const now = new Date().toISOString();
    const store = getDouyinCollectorStore();

    // Dedup: same secUid means the same creator on douyin's side, even if
    // user pastes the URL twice or via different forms (sec_uid vs share
    // link). Returning 409 with the existing id lets the UI point the user
    // at the existing row instead of silently piling up duplicates that
    // double-fire patrols and pollute the list.
    const existing = listCreators(store).find((c) => c.sec_uid === secUid);
    if (existing) {
      return NextResponse.json(
        {
          error: `该博主已订阅：${existing.nickname}`,
          existingId: existing.id,
        },
        { status: 409 },
      );
    }
    const created = store.create<CreatorRecord>(COLLECTION_CREATORS, {
      sec_uid: secUid,
      uid: null,
      nickname,
      avatar: null,
      follow_count: null,
      cadence,
      last_checked_at: null,
      last_failure_reason: null,
      enabled: true,
      updated_at: now,
    });
    return NextResponse.json({ creator: created });
  } catch (err) {
    return errorResponse(err, 400);
  }
}

function normalizeCadence(value: unknown): CreatorCadence {
  if (typeof value === 'string' && (CREATOR_CADENCES as readonly string[]).includes(value)) {
    return value as CreatorCadence;
  }
  return 'daily';
}

function errorResponse(err: unknown, fallbackStatus: number): NextResponse {
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status: fallbackStatus });
}
