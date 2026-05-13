import { NextRequest, NextResponse } from 'next/server';

import {
  getDouyinCollectorStore,
  listCreators,
} from '@/lib/douyin-collector/storage';
import { parseDouyinInput } from '@/lib/douyin-collector/parse-input';
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

    if (!inputRaw && !nicknameRaw) {
      return NextResponse.json(
        { error: '需要输入博主链接、sec_uid 或昵称。' },
        { status: 400 },
      );
    }

    const parsed = parseDouyinInput(inputRaw);
    let secUid: string | null = null;
    if (parsed.kind === 'sec_uid' || parsed.kind === 'profile-url') {
      secUid = parsed.secUid;
    } else if (parsed.kind === 'short-url' || parsed.kind === 'unknown') {
      // 暂未接入解析，先保留原文，待 MCP 桥实现后补上 sec_uid。
      secUid = null;
    } else if (parsed.kind === 'video-url' || parsed.kind === 'aweme_id') {
      return NextResponse.json(
        { error: '看起来是视频链接，请改到「采集任务」按链接采集，或填博主主页链接。' },
        { status: 400 },
      );
    }

    const nickname = nicknameRaw || (secUid ? `博主 ${secUid.slice(0, 8)}…` : `博主 ${inputRaw.slice(0, 12)}`);
    const now = new Date().toISOString();
    const store = getDouyinCollectorStore();

    // Dedup: same secUid means the same creator on douyin's side, even if
    // user pastes the URL twice or via different forms (sec_uid vs share
    // link). Returning 409 with the existing id lets the UI point the user
    // at the existing row instead of silently piling up duplicates that
    // double-fire patrols and pollute the list.
    if (secUid) {
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
