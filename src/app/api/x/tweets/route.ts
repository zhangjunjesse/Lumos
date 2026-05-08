import { NextRequest, NextResponse } from 'next/server';
import { postTweet } from '@/lib/x-platform/tweet';
import { isXAuthExpiredError, xAuthExpiredResponse } from '@/lib/x-platform/auth-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { text?: string; mediaIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'invalid json' }, { status: 400 });
  }
  const text = (body.text || '').trim();
  const mediaIds = Array.isArray(body.mediaIds)
    ? body.mediaIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  if (!text && mediaIds.length === 0) {
    return NextResponse.json({ ok: false, message: '推文必须有文字或图片' }, { status: 400 });
  }
  try {
    const tweet = await postTweet({ text, mediaIds });
    return NextResponse.json({ ok: true, tweet });
  } catch (err) {
    if (isXAuthExpiredError(err)) return xAuthExpiredResponse();
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
