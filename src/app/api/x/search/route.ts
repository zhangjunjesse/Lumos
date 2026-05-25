import { NextRequest, NextResponse } from 'next/server';
import { searchTweets } from '@/lib/x-platform/search';
import { isXAuthExpiredError, xAuthExpiredResponse } from '@/lib/x-platform/auth-error';
import { isXReadTimeoutError } from '@/lib/x-platform/iterator-timeout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseBool(value: string | null): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ ok: false, message: 'q is required' }, { status: 400 });
  const count = Number(req.nextUrl.searchParams.get('maxCount') || req.nextUrl.searchParams.get('count')) || 20;
  const timeoutMs = Number(req.nextUrl.searchParams.get('timeoutMs')) || undefined;
  const allowPartialOnTimeout = parseBool(req.nextUrl.searchParams.get('partial')) || count > 50;
  const modeParam = req.nextUrl.searchParams.get('mode') || 'Top';
  const mode = (['Top', 'Latest', 'Photos', 'Videos', 'Users'].includes(modeParam)
    ? modeParam : 'Top') as 'Top' | 'Latest' | 'Photos' | 'Videos' | 'Users';
  try {
    const result = await searchTweets(q, { count, mode, timeoutMs, allowPartialOnTimeout });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (isXAuthExpiredError(err)) return xAuthExpiredResponse();
    if (isXReadTimeoutError(err)) {
      return NextResponse.json({
        ok: false,
        code: 'X_READ_TIMEOUT',
        message: 'X 搜索请求超时。当前 X 登录态可用，但上游搜索读取太慢或被 X 风控阻断；请稍后重试、减少数量，或重新登录 X。',
      }, { status: 504 });
    }
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
