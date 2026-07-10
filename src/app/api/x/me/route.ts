import { NextRequest, NextResponse } from 'next/server';
import { getAuthStatus } from '@/lib/x-platform/auth';
import {
  verifyAndSaveMyScreenName,
  X_SCREEN_NAME_INVALID,
  X_SCREEN_NAME_MISMATCH,
} from '@/lib/x-platform/identity';
import { isXAuthExpiredError, xAuthExpiredResponse } from '@/lib/x-platform/auth-error';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/x/me — 读当前登录态与已保存的用户名。 */
export async function GET() {
  const status = await getAuthStatus();
  return NextResponse.json({
    ok: true,
    loggedIn: status.loggedIn,
    screenName: status.screenName,
    userId: status.userId,
  });
}

/** POST /api/x/me { screenName } — 校验用户名归属并保存。 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const screenName = String(body?.screenName || '');
  try {
    const result = await verifyAndSaveMyScreenName(screenName);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (isXAuthExpiredError(err)) return xAuthExpiredResponse();
    const code = (err as { code?: string })?.code;
    if (code === X_SCREEN_NAME_INVALID || code === X_SCREEN_NAME_MISMATCH) {
      return NextResponse.json(
        { ok: false, code, message: err instanceof Error ? err.message : String(err) },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
