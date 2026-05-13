import { NextRequest, NextResponse } from 'next/server';
import { searchTweets } from '@/lib/x-platform/search';
import { isXAuthExpiredError, xAuthExpiredResponse } from '@/lib/x-platform/auth-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();
  if (!q) return NextResponse.json({ ok: false, message: 'q is required' }, { status: 400 });
  const count = Number(req.nextUrl.searchParams.get('count')) || 20;
  const modeParam = req.nextUrl.searchParams.get('mode') || 'Top';
  const mode = (['Top', 'Latest', 'Photos', 'Videos', 'Users'].includes(modeParam)
    ? modeParam : 'Top') as 'Top' | 'Latest' | 'Photos' | 'Videos' | 'Users';
  try {
    const result = await searchTweets(q, { count, mode });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (isXAuthExpiredError(err)) return xAuthExpiredResponse();
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
