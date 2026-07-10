import { NextRequest, NextResponse } from 'next/server';
import { searchMyMentions } from '@/lib/x-platform/mentions';
import { X_SCREEN_NAME_UNSET } from '@/lib/x-platform/identity';
import { isXAuthExpiredError, xAuthExpiredResponse } from '@/lib/x-platform/auth-error';
import { isXReadTimeoutError } from '@/lib/x-platform/iterator-timeout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseBool(value: string | null): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * GET /api/x/mentions?count=20 — 搜最近 @ 我的推文。
 * 用户名未设置时回 400 + X_SCREEN_NAME_UNSET,提示先去面板设置。
 */
export async function GET(req: NextRequest) {
  const count = Number(req.nextUrl.searchParams.get('maxCount') || req.nextUrl.searchParams.get('count')) || 20;
  const timeoutMs = Number(req.nextUrl.searchParams.get('timeoutMs')) || undefined;
  const allowPartialOnTimeout = parseBool(req.nextUrl.searchParams.get('partial')) || count > 50;
  try {
    const result = await searchMyMentions({ count, timeoutMs, allowPartialOnTimeout });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (isXAuthExpiredError(err)) return xAuthExpiredResponse();
    if ((err as { code?: string })?.code === X_SCREEN_NAME_UNSET) {
      return NextResponse.json(
        { ok: false, code: X_SCREEN_NAME_UNSET, message: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      );
    }
    if (isXReadTimeoutError(err)) {
      return NextResponse.json({
        ok: false,
        code: 'X_READ_TIMEOUT',
        message: 'X 提及搜索超时。当前登录态可用，但上游读取太慢或被 X 风控阻断；请稍后重试或减少数量。',
      }, { status: 504 });
    }
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
