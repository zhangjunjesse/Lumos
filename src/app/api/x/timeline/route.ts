import { NextRequest, NextResponse } from 'next/server';
import { readHomeTimeline, readUserTweets } from '@/lib/x-platform/timeline';
import { isXAuthExpiredError, xAuthExpiredResponse } from '@/lib/x-platform/auth-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/x/timeline?type=home[&count=20&cursor=...]
 * GET /api/x/timeline?type=user&userId=<id>[&count&cursor]
 */
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type') || 'home';
  const count = Number(req.nextUrl.searchParams.get('count')) || 20;
  const cursor = req.nextUrl.searchParams.get('cursor') || undefined;
  try {
    if (type === 'home') {
      const result = await readHomeTimeline({ count, cursor });
      return NextResponse.json({ ok: true, ...result });
    }
    if (type === 'user') {
      const userId = req.nextUrl.searchParams.get('userId') || '';
      if (!userId) return NextResponse.json({ ok: false, message: 'userId is required for type=user' }, { status: 400 });
      const result = await readUserTweets(userId, { count, cursor });
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ ok: false, message: `unknown type=${type}` }, { status: 400 });
  } catch (err) {
    if (isXAuthExpiredError(err)) return xAuthExpiredResponse();
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
