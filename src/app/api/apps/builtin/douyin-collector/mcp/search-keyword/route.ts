import { NextRequest, NextResponse } from 'next/server';

import { collectKeywordForAi } from '@/lib/douyin-collector/ai-tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    query?: string;
    time_window?: string;
    limit?: number;
    dedupe_window_days?: number;
    auto_process?: boolean;
    publish_to_knowledge?: boolean;
  };
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!query) {
    return NextResponse.json({ error: 'query 不能为空。' }, { status: 400 });
  }
  const result = await collectKeywordForAi(query, {
    timeWindow: body.time_window,
    dedupeWindowDays: body.dedupe_window_days,
    limit: body.limit,
    autoProcess: body.auto_process ?? true,
    publishToKnowledge: body.publish_to_knowledge ?? true,
  });
  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        phase: result.phase ?? 'keyword_collect_failed',
        query,
      },
      { status: 400 },
    );
  }
  if (result.job?.status === 'failed') {
    return NextResponse.json(
      {
        ok: false,
        error: result.job.failure_reason ?? '关键词采集失败。',
        phase: 'collect_failed',
        keyword: result.keyword,
        job: result.job,
        videos: result.videos,
        process: result.process,
      },
      { status: 503 },
    );
  }
  return NextResponse.json({
    ok: true,
    keyword: result.keyword,
    job: result.job,
    videos: result.videos,
    process: result.process,
  });
}
