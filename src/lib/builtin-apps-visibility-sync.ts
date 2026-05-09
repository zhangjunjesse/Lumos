import { getDb } from '@/lib/db/connection';
import {
  getServerHiddenAppIds,
  setServerHiddenAppIds,
} from '@/lib/builtin-apps-visibility';

const LUMOS_WEB_URL = process.env.LUMOS_WEB_URL || 'https://lumos.miki.zj.cn';
const FETCH_TIMEOUT_MS = 5_000;
const WEB_TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

interface MeAppVisibilityResponse {
  success?: boolean;
  data?: {
    apps?: Array<{ id?: string; hidden?: boolean }>;
    hidden?: string[];
  };
}

function getWebSessionToken(userId: string): string | null {
  try {
    const row = getDb()
      .prepare('SELECT web_session_token FROM lumos_users WHERE id = ?')
      .get(userId) as { web_session_token?: string } | undefined;
    const token = row?.web_session_token?.trim();
    if (!token) return null;
    if (!WEB_TOKEN_PATTERN.test(token)) return null;
    return token;
  } catch {
    return null;
  }
}

/**
 * Pull the admin-configured hidden-app list for `userId` from lumos-web and
 * cache it locally. Caller controls the cadence (login, heartbeat, manual
 * settings refresh). Network / auth failures keep the previous cached value
 * so a server outage cannot reveal apps the admin previously hid.
 */
export async function refreshServerHiddenAppIds(
  userId: string,
): Promise<{ ok: true; hidden: string[] } | { ok: false; reason: string }> {
  const webToken = getWebSessionToken(userId);
  if (!webToken) return { ok: false, reason: 'no_web_session' };

  try {
    const res = await fetch(`${LUMOS_WEB_URL}/api/auth/me/app-visibility`, {
      headers: { Cookie: `lumos_session=${webToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 401) {
      return { ok: false, reason: 'unauthenticated' };
    }
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}` };
    }
    const json = (await res.json().catch(() => null)) as MeAppVisibilityResponse | null;
    if (!json?.success || !json.data) return { ok: false, reason: 'malformed' };

    const fromList = Array.isArray(json.data.hidden)
      ? json.data.hidden.filter((v): v is string => typeof v === 'string')
      : Array.isArray(json.data.apps)
        ? json.data.apps
            .filter((a) => typeof a.id === 'string' && a.hidden === true)
            .map((a) => a.id as string)
        : [];

    const hidden = setServerHiddenAppIds(fromList);
    return { ok: true, hidden };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'network_error',
    };
  }
}

export function getCachedServerHiddenAppIds(): string[] {
  return getServerHiddenAppIds();
}
