import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { initScheduler } from '@/lib/scheduler/cron-engine';
import { getMemoryV2SleepConfig } from '@/lib/memory-v2/sleep';
import { runDailyReview } from '@/lib/memory-v2/daily-review';
import { listDailyReviews } from '@/lib/memory-v2/daily-review-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

initScheduler();

const runSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const limit = Number(request.nextUrl.searchParams.get('limit') || '');
    return NextResponse.json({
      reviews: listDailyReviews(Number.isFinite(limit) && limit > 0 ? limit : 30),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load daily reviews';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const input = runSchema.parse(body);
    const run = await runDailyReview({
      trigger: 'api',
      day: input.day,
      timezone: getMemoryV2SleepConfig().timezone,
    });
    // run 已记录就是一次成功的请求；run.status 才表达业务结果（含 error/unavailable/empty）。
    // 只有真正的异常（catch）才算 HTTP 失败。
    return NextResponse.json({ reviews: listDailyReviews(30), run }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run daily review';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
