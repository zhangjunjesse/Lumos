import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/connection';
import { destroySession } from '@/lib/auth/session';
import { getUserBySession } from '@/lib/auth/user-service';

const LUMOS_WEB_URL = process.env.LUMOS_WEB_URL || 'http://lumos.miki.zj.cn';
const HEARTBEAT_TIMEOUT_MS = 5_000;

// lumos-web session tokens are 32 random bytes hex-encoded (64 hex chars).
const WEB_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

/**
 * GET /api/auth/pro-heartbeat
 *
 * Used by ProAuthGate to detect single-device-login eviction.
 * Pings lumos-web /api/auth/me with the user's stored web_session_token.
 * Only a 401 means "kicked" — 5xx / network errors keep the client logged in
 * so a lumos-web outage doesn't mass-logout the fleet.
 *
 * Returns { valid, reason? }.
 */
export async function GET(req: NextRequest) {
  const token = req.cookies.get('lumos_session')?.value;
  if (!token) {
    return NextResponse.json({ valid: false, reason: 'no_session' });
  }

  const user = getUserBySession(token);
  if (!user) {
    return NextResponse.json({ valid: false, reason: 'local_expired' });
  }

  const row = getDb()
    .prepare('SELECT web_session_token FROM lumos_users WHERE id = ?')
    .get(user.id) as { web_session_token: string } | undefined;
  const webToken = row?.web_session_token || '';
  if (!webToken) {
    // Pre-migration user without a web session — don't kick.
    return NextResponse.json({ valid: true, reason: 'no_web_token' });
  }

  // Defense-in-depth: reject anything that doesn't match the expected hex shape
  // before interpolating into the Cookie header.
  if (!WEB_TOKEN_PATTERN.test(webToken)) {
    return NextResponse.json({ valid: true, reason: 'malformed_token' });
  }

  try {
    const res = await fetch(`${LUMOS_WEB_URL}/api/auth/me`, {
      headers: { Cookie: `lumos_session=${webToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
    });

    if (res.status === 401) {
      // Kicked by a newer login. Clean up local state.
      destroySession(token);
      const resp = NextResponse.json({ valid: false, reason: 'kicked' });
      resp.cookies.delete('lumos_session');
      return resp;
    }

    // 2xx with success=true → still logged in.
    // 5xx / 403 / other → inconclusive, don't log the user out for a server hiccup.
    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data && data.success) return NextResponse.json({ valid: true });
    }
    return NextResponse.json({ valid: true, reason: 'inconclusive' });
  } catch {
    // Network failure — inconclusive, keep current state.
    return NextResponse.json({ valid: true, reason: 'network_error' });
  }
}
