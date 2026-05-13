import { NextRequest, NextResponse } from 'next/server';
import { readUserTweets } from '@/lib/x-platform/timeline';
import { isXAuthExpiredError, xAuthExpiredResponse } from '@/lib/x-platform/auth-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/x/timeline?screen=<username>[&count=20]
 *
 * 拉某个用户(@xxx)的最近推文。home timeline 暂未支持(@the-convocation 没暴露)。
 */
export async function GET(req: NextRequest) {
  const screen = (req.nextUrl.searchParams.get('screen') || '').trim();
  if (!screen) {
    return NextResponse.json({ ok: false, message: 'screen is required (X 用户名,带不带 @ 都行)' }, { status: 400 });
  }
  const count = Number(req.nextUrl.searchParams.get('count')) || 20;
  try {
    const result = await readUserTweets(screen, { count });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (isXAuthExpiredError(err)) return xAuthExpiredResponse();
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
