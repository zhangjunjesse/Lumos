// GET /api/x/dm/inbox — 读 X 私信收件箱(对话列表)。只读。
import { NextResponse } from 'next/server';
import { getDmInboxView } from '@/lib/x-platform/dm';
import { isXAuthExpiredError, xAuthExpiredResponse } from '@/lib/x-platform/auth-error';
import { isXReadTimeoutError } from '@/lib/x-platform/iterator-timeout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...(await getDmInboxView()) });
  } catch (err) {
    if (isXAuthExpiredError(err)) return xAuthExpiredResponse();
    if (isXReadTimeoutError(err)) {
      return NextResponse.json(
        { ok: false, code: 'X_READ_TIMEOUT', message: 'X 私信读取超时:登录态可用,但上游读取太慢或被风控阻断,请稍后重试或重新登录 X。' },
        { status: 504 },
      );
    }
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
