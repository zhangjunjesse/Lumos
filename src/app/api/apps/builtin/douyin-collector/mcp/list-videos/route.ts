import { NextRequest, NextResponse } from 'next/server';

import { listCollectedVideos } from '@/lib/douyin-collector/video-list';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 列出已采集视频（精简投影），供 MCP 工具 douyin_list_content 调用。
 * 只解析参数 + 调 lib，业务在 video-list.ts。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      query?: unknown;
      library_status?: unknown;
      transcript_status?: unknown;
      limit?: unknown;
      offset?: unknown;
    };
    const result = listCollectedVideos({
      query: typeof body.query === 'string' ? body.query : null,
      libraryStatus: typeof body.library_status === 'string' ? body.library_status : null,
      transcriptStatus: typeof body.transcript_status === 'string' ? body.transcript_status : null,
      limit: typeof body.limit === 'number' ? body.limit : null,
      offset: typeof body.offset === 'number' ? body.offset : null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
