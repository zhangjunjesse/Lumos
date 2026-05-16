import { NextRequest, NextResponse } from 'next/server';

import { parseDouyinInput } from '@/lib/douyin-collector/parse-input';
import { fetchVideoMetadata, resolveShortLink } from '@/lib/douyin-collector/scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { input?: string };
    const input = typeof body.input === 'string' ? body.input.trim() : '';
    if (!input) {
      return NextResponse.json({ ok: false, error: 'input 不能为空。' }, { status: 400 });
    }
    let parsed = parseDouyinInput(input);

    // Short links: follow the redirect once, re-parse the canonical URL.
    if (parsed.kind === 'short-url') {
      const resolved = await resolveShortLink(parsed.shortToken);
      if (!resolved) {
        return NextResponse.json(
          {
            ok: false,
            error: `短链解析失败：v.douyin.com/${parsed.shortToken} 不可达。`,
            phase: 'not_connected',
            parsed,
          },
          { status: 503 },
        );
      }
      parsed = parseDouyinInput(resolved);
    }

    let awemeId: string | null = null;
    if (parsed.kind === 'aweme_id') awemeId = parsed.awemeId;
    else if (parsed.kind === 'video-url') awemeId = parsed.awemeId;

    if (!awemeId) {
      return NextResponse.json(
        { ok: false, error: '需要抖音视频链接或 aweme_id。', parsed },
        { status: 400 },
      );
    }

    const outcome = await fetchVideoMetadata(awemeId);
    if (!outcome.ok) {
      return NextResponse.json(
        { ok: false, error: outcome.reason, phase: outcome.phase, awemeId, parsed },
        { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, metadata: outcome.metadata, parsed });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        ok: false,
        phase: 'detail_exception',
        error: `抖音视频详情服务异常：${message}`,
      },
      { status: 502 },
    );
  }
}
