/**
 * Lumos Cloud authentication module (Pro edition).
 *
 * Handles login / register / token management against the new-api backend
 * at api.miki.zj.cn, and auto-provisions a "Lumos Cloud" provider in the
 * local SQLite database.
 */

const CLOUD_API_BASE = 'http://api.miki.zj.cn';
const CLOUD_PROVIDER_NAME = 'Lumos Cloud';

/* ── Types ─────────────────────────────────────────────── */

export interface CloudUserInfo {
  id: number;
  username: string;
  display_name: string;
  email: string;
  role: number;
  status: number;
  quota: number;
  used_quota: number;
  request_count: number;
  group: string;
}

export interface CloudTokenInfo {
  id: number;
  name: string;
  key: string;
  status: number;
  used_quota: number;
  remain_quota: number;
  unlimited_quota: boolean;
  created_time: number;
  expired_time: number;
}

interface CloudApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
}

/* ── Low-level API calls ───────────────────────────────── */

let sessionCookie = '';
let currentUserId = 0;

async function cloudRequest<T>(
  path: string,
  options?: RequestInit,
): Promise<CloudApiResponse<T>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (sessionCookie) {
    headers['Cookie'] = sessionCookie;
  }
  if (currentUserId) {
    headers['New-Api-User'] = String(currentUserId);
  }

  const res = await fetch(`${CLOUD_API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers as Record<string, string> },
  });

  // Capture session cookie from Set-Cookie header
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) {
    const match = setCookie.match(/session=([^;]+)/);
    if (match) {
      sessionCookie = `session=${match[1]}`;
    }
  }

  return res.json() as Promise<CloudApiResponse<T>>;
}

/* ── Public API ────────────────────────────────────────── */

export async function cloudLogin(
  username: string,
  password: string,
): Promise<CloudApiResponse<CloudUserInfo>> {
  const res = await cloudRequest<CloudUserInfo>('/api/user/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  if (res.success && res.data) {
    currentUserId = res.data.id;
  }
  return res;
}

export async function cloudRegister(
  username: string,
  password: string,
  email: string,
): Promise<CloudApiResponse<unknown>> {
  return cloudRequest('/api/user/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, email }),
  });
}

export async function cloudGetUser(): Promise<CloudApiResponse<CloudUserInfo>> {
  return cloudRequest<CloudUserInfo>('/api/user/self');
}

interface PaginatedTokens {
  items: CloudTokenInfo[];
  total: number;
}

export async function cloudGetTokens(): Promise<CloudTokenInfo[]> {
  const res = await cloudRequest<PaginatedTokens>('/api/token/', { method: 'GET' });
  return res.data?.items ?? [];
}

export async function cloudCreateToken(name: string): Promise<CloudApiResponse<CloudTokenInfo>> {
  return cloudRequest<CloudTokenInfo>('/api/token/', {
    method: 'POST',
    body: JSON.stringify({
      name,
      remain_quota: 0,
      unlimited_quota: true,
    }),
  });
}

export function cloudLogout(): void {
  sessionCookie = '';
  currentUserId = 0;
}

export function isCloudLoggedIn(): boolean {
  return currentUserId > 0 && sessionCookie.length > 0;
}

export function getCloudUserId(): number {
  return currentUserId;
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
    provider_type: 'custom',
    api_protocol: 'anthropic-messages',
    capabilities: JSON.stringify(['agent-chat']),
    provider_origin: 'system',
    auth_mode: 'api_key',
    base_url: CLOUD_API_BASE,
    api_key: apiKey,
    model_catalog: JSON.stringify([
      { value: 'doubao-seed-2.0-lite', label: 'Doubao Seed 2.0 Lite' },
      { value: 'doubao-seed-2.0-pro', label: 'Doubao Seed 2.0 Pro' },
      { value: 'doubao-seed-2.0-code', label: 'Doubao Seed 2.0 Code' },
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
 * Full login flow for Pro edition:
 * 1. Login to cloud
 * 2. Find or create an API token
 * 3. Provision/update local Lumos Cloud provider
 *
 * Returns the full API key for display.
 */
export async function cloudLoginAndProvision(
  username: string,
  password: string,
): Promise<{ user: CloudUserInfo; tokenKey: string; providerId: string }> {
  // 1. Login
  const loginRes = await cloudLogin(username, password);
  if (!loginRes.success || !loginRes.data) {
    throw new Error(loginRes.message || '登录失败');
  }
  const user = loginRes.data;

  // 2. Find existing token or create one
  const tokens = await cloudGetTokens();
  let tokenKey: string;

  const lumosToken = tokens.find(t => t.name === 'lumos-client' && t.status === 1);
  if (lumosToken) {
    // Existing token — key is masked in list API, need to use it as-is
    // For first login, we create a new token to get the full key
    tokenKey = lumosToken.key;
  } else {
    const createRes = await cloudCreateToken('lumos-client');
    if (!createRes.success || !createRes.data) {
      throw new Error(createRes.message || '创建令牌失败');
    }
    tokenKey = createRes.data.key;
  }

  // 3. Provision local provider
  const providerId = await provisionCloudProvider(tokenKey);

  return { user, tokenKey, providerId };
}
