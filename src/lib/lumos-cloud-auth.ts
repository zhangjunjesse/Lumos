/**
 * Lumos Cloud authentication module.
 *
 * Desktop app authenticates against the lumos-web website (lumos.miki.zj.cn),
 * which returns the user's new-api token key for API access.
 */

import { fetchCloudAvailableModels } from '@/lib/lumos-cloud-models';
import {
  CUSTOM_PROVIDER_CAPABILITIES,
  CUSTOM_PROVIDER_SETTING_KEYS,
  type CustomProviderFlags,
} from '@/lib/auth/custom-provider-capabilities';

const CLOUD_WEB_BASE = process.env.LUMOS_WEB_URL || 'http://lumos.miki.zj.cn';
const CLOUD_API_BASE = process.env.LUMOS_API_URL || 'http://api.miki.zj.cn';
const CLOUD_PROVIDER_NAME = 'Lumos Cloud';
const CLOUD_IMAGE_PROVIDER_ID_SETTING = 'lumos_cloud_image_provider_id';

/**
 * Fallback model list for the very first login when /v1/models is unreachable.
 * Once a successful fetch happens, the persisted catalog overrides this.
 */
const CLOUD_FALLBACK_MODEL_CATALOG: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'doubao-seed-2-0-mini-260215', label: 'doubao-seed-2-0-mini-260215' },
  { value: 'doubao-seed-2-0-lite-260215', label: 'doubao-seed-2-0-lite-260215' },
  { value: 'doubao-seed-2-0-pro-260215', label: 'doubao-seed-2-0-pro-260215' },
  { value: 'doubao-seed-2-0-code-preview-260215', label: 'doubao-seed-2-0-code-preview-260215' },
];

/* ── Types ─────────────────────────────────────────────── */

export interface CloudUserInfo {
  id: string;
  email: string;
  nickname: string;
  role: string;
  membership: string;
  status: string;
  newapi_token_key: string | null;
  image_provider?: CloudImageProviderConfig | null;
  /** Per-capability admin toggles. Absent fields are treated as false. */
  allow_custom_providers?: Partial<CustomProviderFlags>;
}

/**
 * Persist the pro-edition per-capability "allow custom provider" flags.
 * Stored as '1'/'0' under one settings key per capability so the runtime
 * resolver and `/api/auth/me` can read them synchronously.
 */
export async function persistCustomProviderFlags(flags: Partial<CustomProviderFlags>): Promise<void> {
  const { getDb } = await import('@/lib/db/connection');
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const cap of CUSTOM_PROVIDER_CAPABILITIES) {
    stmt.run(CUSTOM_PROVIDER_SETTING_KEYS[cap], flags[cap] === true ? '1' : '0');
  }
}

export interface CloudImageProviderModel {
  value: string;
  label: string;
}

export interface CloudImageProviderConfig {
  enabled: boolean;
  name: string;
  provider_type: string;
  api_protocol: string;
  base_url: string;
  api_key: string;
  default_model: string;
  model_catalog: CloudImageProviderModel[];
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
 * Ensures a "Lumos Cloud" provider exists in the local DB with the given
 * API token and (when reachable) the user's actual available model list
 * pulled from new-api's /v1/models. Behavior:
 *
 * - On every login: api_key is overwritten and default_provider_id is set.
 * - If /v1/models succeeds: model_catalog + model_catalog_updated_at are
 *   refreshed with the live list.
 * - If /v1/models fails on an existing provider: the persisted catalog is
 *   left untouched (we don't downgrade a known-good list to the fallback).
 * - If /v1/models fails on first creation: the hard-coded fallback catalog
 *   is seeded so the UI is not empty.
 *
 * Runs server-side in API routes only.
 */
export async function provisionCloudProvider(apiKey: string): Promise<string> {
  // Dynamic import to avoid bundling server-only DB code on the client
  const { getDb } = await import('@/lib/db/connection');
  const db = getDb();

  const remoteModels = await fetchCloudAvailableModels(CLOUD_API_BASE, apiKey);
  const hasRemoteModels = remoteModels.length > 0;
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  // Check if a Lumos Cloud provider already exists
  const existing = db.prepare(
    "SELECT id FROM api_providers WHERE name = ? AND provider_origin = 'system'"
  ).get(CLOUD_PROVIDER_NAME) as { id: string } | undefined;

  if (existing) {
    if (hasRemoteModels) {
      db.prepare(
        'UPDATE api_providers SET api_key = ?, model_catalog = ?, model_catalog_source = ?, model_catalog_updated_at = ?, updated_at = ? WHERE id = ?',
      ).run(apiKey, JSON.stringify(remoteModels), 'detected', now, now, existing.id);
    } else {
      // Fetch failed — keep existing catalog, only refresh the key.
      db.prepare(
        'UPDATE api_providers SET api_key = ?, updated_at = ? WHERE id = ?',
      ).run(apiKey, now, existing.id);
    }

    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('default_provider_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ).run(existing.id);

    return existing.id;
  }

  // Create new provider — use detected models when available, fallback otherwise.
  const { createProvider } = await import('@/lib/db/providers');
  const initialCatalog = hasRemoteModels ? remoteModels : CLOUD_FALLBACK_MODEL_CATALOG;
  const provider = createProvider({
    name: CLOUD_PROVIDER_NAME,
    provider_type: 'anthropic',
    api_protocol: 'anthropic-messages',
    capabilities: JSON.stringify(['agent-chat']),
    provider_origin: 'system',
    auth_mode: 'api_key',
    base_url: CLOUD_API_BASE,
    api_key: apiKey,
    model_catalog: JSON.stringify(initialCatalog),
    model_catalog_source: hasRemoteModels ? 'detected' : 'default',
    notes: 'Lumos Cloud 内置服务商，由登录自动配置',
  });

  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('default_provider_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(provider.id);

  return provider.id;
}

/**
 * Provision / update / delete the cloud image provider based on admin config.
 *
 * Identity: we persist the provider id in settings under
 * `lumos_cloud_image_provider_id` so renames in the admin UI don't break lookup.
 *
 * Behavior:
 * - `config = null` → delete any previously provisioned image provider and clear
 *   `provider_override:image`.
 * - `config` present → upsert the provider (system origin, image-gen capability)
 *   and set `provider_override:image` to its id.
 */
interface ImageProviderUpsertFields {
  name: string;
  provider_type: string;
  api_protocol: 'anthropic-messages' | 'openai-compatible';
  capabilities: string;
  provider_origin: 'system';
  auth_mode: 'api_key';
  base_url: string;
  api_key: string;
  model_catalog: string;
  notes: string;
}

function buildImageProviderFields(config: CloudImageProviderConfig): ImageProviderUpsertFields {
  const apiProtocol = config.api_protocol === 'anthropic-messages' ? 'anthropic-messages' : 'openai-compatible';
  return {
    name: config.name,
    provider_type: config.provider_type,
    api_protocol: apiProtocol,
    capabilities: JSON.stringify(['image-gen']),
    provider_origin: 'system',
    auth_mode: 'api_key',
    base_url: config.base_url,
    api_key: config.api_key,
    model_catalog: JSON.stringify(config.model_catalog || []),
    notes: `Lumos Cloud 内置图片服务商，由登录自动配置。默认模型：${config.default_model}`,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cleanupProvisionedImageProvider(db: any, storedId: string): Promise<void> {
  const { deleteProvider } = await import('@/lib/db/providers');
  try { deleteProvider(storedId); } catch { /* already gone */ }
  db.prepare('DELETE FROM settings WHERE key = ?').run(CLOUD_IMAGE_PROVIDER_ID_SETTING);
  db.prepare("DELETE FROM settings WHERE key = 'provider_override:image'").run();
}

export async function provisionImageProvider(
  config: CloudImageProviderConfig | null,
): Promise<string | null> {
  const { getDb } = await import('@/lib/db/connection');
  const { createProvider, updateProvider } = await import('@/lib/db/providers');
  const db = getDb();

  const storedIdRow = db.prepare('SELECT value FROM settings WHERE key = ?')
    .get(CLOUD_IMAGE_PROVIDER_ID_SETTING) as { value: string } | undefined;
  const storedId = storedIdRow?.value || null;

  if (!config) {
    if (storedId) await cleanupProvisionedImageProvider(db, storedId);
    return null;
  }

  const fields = buildImageProviderFields(config);
  const existing = storedId
    ? (db.prepare('SELECT id FROM api_providers WHERE id = ?').get(storedId) as { id: string } | undefined)
    : undefined;

  let providerId: string;
  if (existing) {
    updateProvider(existing.id, fields);
    providerId = existing.id;
  } else {
    const provider = createProvider({ ...fields, model_catalog_source: 'default' });
    providerId = provider.id;
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(CLOUD_IMAGE_PROVIDER_ID_SETTING, providerId);
  }

  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('provider_override:image', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(providerId);

  return providerId;
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

  // Image provider is optional — may be disabled or unconfigured on the server
  await provisionImageProvider(user.image_provider ?? null);

  return { user, tokenKey, providerId };
}
