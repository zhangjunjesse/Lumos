import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/connection';
import { destroySession } from '@/lib/auth/session';
import {
  getUserById,
  getUserBySession,
  provisionUserServices,
  type RemoteUser,
} from '@/lib/auth/user-service';
import { getCustomProviderFlags } from '@/lib/edition-runtime';
import { composeAuthPayload } from '@/lib/auth/payload';

const LUMOS_WEB_URL = process.env.LUMOS_WEB_URL || 'https://lumos.miki.zj.cn';
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
      if (data && data.success) {
        // Piggyback admin-config sync onto the heartbeat. lumos-web /api/auth/me
        // returns the same RemoteUser shape as /login, so we can feed it straight
        // into provisionUserServices to refresh chat providers, image providers,
        // and custom-provider flags without waiting for the next full login.
        // Best-effort: a sync failure must not invalidate an otherwise healthy
        // session, so we swallow and log.
        let synced = false;
        const remoteUser = (data.data?.user ?? data.data) as RemoteUser | undefined;
        if (remoteUser && typeof remoteUser === 'object' && remoteUser.id) {
          try {
            await provisionUserServices(remoteUser);
            synced = true;
          } catch (e) {
            console.warn('[heartbeat] provision sync failed:', e);
          }
        }
        // Always return the fresh user payload so the client can refresh
        // balance / membership / flags without a manual reload. Balance
        // comes straight from the lumos-web response we just fetched —
        // no second roundtrip needed.
        const freshUser = getUserById(user.id) ?? user;
        const balance = Number(data.data?.balance ?? data.data?.user?.balance ?? 0);
        const usedQuota = Number(data.data?.used_quota ?? data.data?.user?.used_quota ?? 0);
        const payload = composeAuthPayload(freshUser, balance, usedQuota, getCustomProviderFlags());
        return NextResponse.json({ valid: true, synced, user: payload });
      }
    }
    return NextResponse.json({ valid: true, reason: 'inconclusive' });
  } catch {
    // Network failure — inconclusive, keep current state.
    return NextResponse.json({ valid: true, reason: 'network_error' });
  }
}
