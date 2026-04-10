/**
 * Lumos Cloud authentication module.
 *
 * Desktop app authenticates against the lumos-web website (lumos.miki.zj.cn),
 * which returns the user's new-api token key for API access.
 */

const CLOUD_WEB_BASE = process.env.LUMOS_WEB_URL || 'http://lumos.miki.zj.cn';
const CLOUD_API_BASE = process.env.LUMOS_API_URL || 'http://api.miki.zj.cn';
const CLOUD_PROVIDER_NAME = 'Lumos Cloud';

/* ── Types ─────────────────────────────────────────────── */

export interface CloudUserInfo {
  id: string;
  email: string;
  nickname: string;
  role: string;
  membership: string;
  status: string;
  newapi_token_key: string | null;
}

/* ── State ─────────────────────────────────────────────── */

let currentUser: CloudUserInfo | null = null;

/* ── Public API ────────────────────────────────────────── */

export async function cloudLogin(
  account: string,
  password: string,
): Promise<CloudUserInfo> {
  const res = await fetch(`${CLOUD_WEB_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account, password }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || '登录失败');
  currentUser = data.data;
  return data.data;
}

export function cloudLogout(): void {
  currentUser = null;
}

export function isCloudLoggedIn(): boolean {
  return currentUser !== null;
}

export function getCloudUser(): CloudUserInfo | null {
  return currentUser;
}

/* ── Provider provisioning ─────────────────────────────── */

/**
 * Ensures a "Lumos Cloud" provider exists in the local DB with the
 * given API token. If one already exists, updates the key; otherwise
 * creates a new provider and sets it as default.
 *
 * This runs server-side in API routes.
 */
export async function provisionCloudProvider(apiKey: string): Promise<string> {
  // Dynamic import to avoid bundling server-only DB code on the client
  const { getDb } = await import('@/lib/db/connection');
  const db = getDb();

  // Check if a Lumos Cloud provider already exists
  const existing = db.prepare(
    "SELECT id FROM api_providers WHERE name = ? AND provider_origin = 'system'"
  ).get(CLOUD_PROVIDER_NAME) as { id: string } | undefined;

  if (existing) {
    // Update the API key
    db.prepare(
      'UPDATE api_providers SET api_key = ?, updated_at = ? WHERE id = ?'
    ).run(apiKey, new Date().toISOString().replace('T', ' ').split('.')[0], existing.id);

    // Ensure it's the default
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('default_provider_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(existing.id);

    return existing.id;
  }

  // Create new provider
  const { createProvider } = await import('@/lib/db/providers');
  const provider = createProvider({
    name: CLOUD_PROVIDER_NAME,
    provider_type: 'anthropic',
    api_protocol: 'anthropic-messages',
    capabilities: JSON.stringify(['agent-chat']),
    provider_origin: 'system',
    auth_mode: 'api_key',
    base_url: CLOUD_API_BASE,
    api_key: apiKey,
    model_catalog: JSON.stringify([
      { value: 'doubao-seed-2-0-mini-260215', label: 'doubao-seed-2-0-mini-260215' },
      { value: 'doubao-seed-2-0-lite-260215', label: 'doubao-seed-2-0-lite-260215' },
      { value: 'doubao-seed-2-0-pro-260215', label: 'doubao-seed-2-0-pro-260215' },
      { value: 'doubao-seed-2-0-code-preview-260215', label: 'doubao-seed-2-0-code-preview-260215' },
    ]),
    model_catalog_source: 'default',
    notes: 'Lumos Cloud 内置服务商，由登录自动配置',
  });

  // Set as default
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('default_provider_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(provider.id);

  return provider.id;
}

/**
 * Full login flow:
 * 1. Login to lumos-web website
 * 2. Get new-api token key from user profile
 * 3. Provision/update local Lumos Cloud provider
 */
export async function cloudLoginAndProvision(
  account: string,
  password: string,
): Promise<{ user: CloudUserInfo; tokenKey: string; providerId: string }> {
  const user = await cloudLogin(account, password);

  if (!user.newapi_token_key) {
    throw new Error('账户未分配 API 令牌，请联系管理员');
  }

  const tokenKey = `sk-${user.newapi_token_key}`;
  const providerId = await provisionCloudProvider(tokenKey);

  return { user, tokenKey, providerId };
}
