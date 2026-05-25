import { NextRequest, NextResponse } from 'next/server';
import { isXAuthExpiredError, xAuthExpiredResponse } from '@/lib/x-platform/auth-error';
import { isXReadTimeoutError } from '@/lib/x-platform/iterator-timeout';
import { getTweetById, readTweetReplies } from '@/lib/x-platform/thread';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseTweetId(value: string): string {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return trimmed.match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/)?.[1] || '';
}

function parseBool(value: string | null): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * GET /api/x/thread?id=<tweetId|url>[&count=100][&includeMain=1]
 *
 * 拉单条推文和同 conversation 下的评论 / 续推。评论采集支持大于 50 的批量读取,
 * 但 X 返回的是搜索式 conversation 结果,不是完整树状评论区。
 */
export async function GET(req: NextRequest) {
  const id = parseTweetId(req.nextUrl.searchParams.get('id') || req.nextUrl.searchParams.get('url') || '');
  if (!id) {
    return NextResponse.json({ ok: false, message: 'id or url is required' }, { status: 400 });
  }

  const count = Number(req.nextUrl.searchParams.get('maxCount') || req.nextUrl.searchParams.get('count')) || 20;
  const timeoutMs = Number(req.nextUrl.searchParams.get('timeoutMs')) || undefined;
  const includeMain = req.nextUrl.searchParams.get('includeMain') !== '0';
  const allowPartialOnTimeout = parseBool(req.nextUrl.searchParams.get('partial')) || count > 20;

  try {
    const tweet = includeMain ? await getTweetById(id, { timeoutMs }) : null;
    const conversationId = tweet?.conversationId || id;
    const replies = await readTweetReplies(conversationId, {
      count,
      excludeId: id,
      timeoutMs,
      allowPartialOnTimeout,
    });
    return NextResponse.json({
      ok: true,
      tweet,
      conversationId,
      replies: replies.hits,
      requestedReplyCount: replies.requestedCount,
      returnedReplyCount: replies.returnedCount,
      maxSupportedReplyCount: replies.maxSupportedCount,
      partial: replies.partial,
      timedOut: replies.timedOut,
      durationMs: replies.durationMs,
      ...(replies.error ? { error: replies.error } : {}),
    });
  } catch (err) {
    if (isXAuthExpiredError(err)) return xAuthExpiredResponse();
    if (isXReadTimeoutError(err)) {
      return NextResponse.json({
        ok: false,
        code: 'X_READ_TIMEOUT',
        message: 'X 推文评论请求超时。当前 X 登录态可用，但上游读取太慢或被 X 风控阻断；请稍后重试、减少数量，或重新登录 X。',
      }, { status: 504 });
    }
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
