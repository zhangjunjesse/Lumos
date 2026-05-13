import { NextRequest, NextResponse } from 'next/server';

import { parseDouyinInput } from '@/lib/douyin-collector/parse-input';
import { fetchCreatorVideos, resolveShortLink } from '@/lib/douyin-collector/scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { input?: string; limit?: number };
  const input = typeof body.input === 'string' ? body.input.trim() : '';
  if (!input) {
    return NextResponse.json({ error: 'input 不能为空。' }, { status: 400 });
  }
  let parsed = parseDouyinInput(input);

  // Resolve short link if needed.
  if (parsed.kind === 'short-url') {
    const resolved = await resolveShortLink(parsed.shortToken);
    if (!resolved) {
      return NextResponse.json(
        { error: `短链解析失败：v.douyin.com/${parsed.shortToken} 不可达。`, parsed },
        { status: 503 },
      );
    }
    parsed = parseDouyinInput(resolved);
  }

  let secUid: string | null = null;
  if (parsed.kind === 'sec_uid') secUid = parsed.secUid;
  else if (parsed.kind === 'profile-url') secUid = parsed.secUid;

  if (!secUid) {
    return NextResponse.json(
      { error: '需要博主主页链接或 sec_uid。', parsed },
      { status: 400 },
    );
  }

  const limit = Math.max(1, Math.min(100, Number(body.limit ?? 30)));
  const outcome = await fetchCreatorVideos(secUid);
  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.reason, phase: outcome.phase, secUid },
      { status: 503 },
    );
  }
  const videos = outcome.profile.videos.slice(0, limit);
  return NextResponse.json({
    ok: true,
    profile: {
      secUid,
      nickname: outcome.profile.nickname,
      avatar: outcome.profile.avatar,
      followerCount: outcome.profile.followerCount,
    },
    videos,
    totalReturned: videos.length,
    truncated: outcome.profile.videos.length > limit,
  });
}
