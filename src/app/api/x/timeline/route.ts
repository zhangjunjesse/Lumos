import { NextRequest, NextResponse } from 'next/server';
import { readUserTweets } from '@/lib/x-platform/timeline';
import { isXAuthExpiredError, xAuthExpiredResponse } from '@/lib/x-platform/auth-error';
import { isXReadTimeoutError } from '@/lib/x-platform/iterator-timeout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/x/timeline?screen=<username>[&count=20|&maxCount=200]
 *
 * 拉某个用户(@xxx)的最近推文。home timeline 暂未支持(@the-convocation 没暴露)。
 */
function parseBool(value: string | null): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

export async function GET(req: NextRequest) {
  const screen = (req.nextUrl.searchParams.get('screen') || '').trim();
  if (!screen) {
    return NextResponse.json({ ok: false, message: 'screen is required (X 用户名,带不带 @ 都行)' }, { status: 400 });
  }
  const count = Number(req.nextUrl.searchParams.get('maxCount') || req.nextUrl.searchParams.get('count')) || 20;
  const timeoutMs = Number(req.nextUrl.searchParams.get('timeoutMs')) || undefined;
  const allowPartialOnTimeout = parseBool(req.nextUrl.searchParams.get('partial')) || count > 50;
  try {
    const result = await readUserTweets(screen, { count, timeoutMs, allowPartialOnTimeout });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (isXAuthExpiredError(err)) return xAuthExpiredResponse();
    if (isXReadTimeoutError(err)) {
      return NextResponse.json({
        ok: false,
        code: 'X_READ_TIMEOUT',
        message: 'X 用户时间线请求超时。当前 X 登录态可用，但上游读取太慢或被 X 风控阻断；请稍后重试、减少数量，或重新登录 X。',
      }, { status: 504 });
    }
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
