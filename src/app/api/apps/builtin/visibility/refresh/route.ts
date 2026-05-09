import { NextRequest, NextResponse } from 'next/server';

import { getUserBySession } from '@/lib/auth/user-service';
import { refreshServerHiddenAppIds } from '@/lib/builtin-apps-visibility-sync';
import { getBuiltinAppVisibility } from '@/lib/builtin-apps-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST — pull the admin-configured visibility list from lumos-web for the
 * currently logged-in desktop user, write it to local cache, and return the
 * fresh visibility map. Used by the Settings page "刷新" button and any
 * post-login flows that want immediate sync rather than waiting for the
 * heartbeat.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get('lumos_session')?.value;
  if (!token) {
    return NextResponse.json(
      { ok: false, error: 'not_logged_in', apps: getBuiltinAppVisibility() },
      { status: 401 },
    );
  }
  const user = getUserBySession(token);
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'session_expired', apps: getBuiltinAppVisibility() },
      { status: 401 },
    );
  }

  const result = await refreshServerHiddenAppIds(user.id);
  return NextResponse.json({
    ok: result.ok,
    reason: result.ok ? undefined : result.reason,
    apps: getBuiltinAppVisibility(),
  });
}
