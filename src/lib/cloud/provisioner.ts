/**
 * Lumos Cloud 本地 provider 的 upsert / 清理。
 *
 * 运行时只在 API 路由服务端调用。对 DB 的依赖通过 `DbLike` 最小接口表达,
 * 既可以直接传 better-sqlite3 的 Database, 也可以在单测中 duck-type 一个 mock,
 * 因此不需要任何 `any`。
 */
import { fetchCloudAvailableModels } from '@/lib/lumos-cloud-models';
import type { CloudImageProviderConfig } from './types';

const CLOUD_API_BASE = process.env.LUMOS_API_URL || 'http://api.miki.zj.cn';
const CLOUD_PROVIDER_NAME = 'Lumos Cloud';
const CLOUD_IMAGE_PROVIDER_ID_SETTING = 'lumos_cloud_image_provider_id';

/**
 * 首次登录且 /v1/models 不可达时的兜底模型清单。成功拉取一次后会被
 * 持久化的 catalog 覆盖, 因此列表本身不需要维护得太精确。
 */
const CLOUD_FALLBACK_MODEL_CATALOG: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'doubao-seed-2-0-mini-260215', label: 'doubao-seed-2-0-mini-260215' },
  { value: 'doubao-seed-2-0-lite-260215', label: 'doubao-seed-2-0-lite-260215' },
  { value: 'doubao-seed-2-0-pro-260215', label: 'doubao-seed-2-0-pro-260215' },
  { value: 'doubao-seed-2-0-code-preview-260215', label: 'doubao-seed-2-0-code-preview-260215' },
];

// ── DB 抽象 (避免把 better-sqlite3 类型硬绑到调用方) ───────────────────────

export interface DbStatementLike {
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes: number } | unknown;
}
export interface DbLike {
  prepare(sql: string): DbStatementLike;
}

// ── default_provider_id 兜底 ──────────────────────────────────────────────

/**
 * 只在 `default_provider_id` 缺失 / 指向已删 provider 时写入, 不覆盖用户自选。
 * Pro 版管控由 resolver 在 `getLumosCloudSystemProvider()` 中做,
 * 登录流程不再改写此 setting。
 *
 * @internal 暴露给单测用。
 */
export function ensureDefaultProviderFallback(db: DbLike, cloudProviderId: string): void {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'default_provider_id'")
    .get() as { value?: string } | undefined;
  const currentId = row?.value?.trim() ?? '';
  if (currentId) {
    const exists = db.prepare('SELECT 1 FROM api_providers WHERE id = ?').get(currentId);
    if (exists) return;
  }
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('default_provider_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(cloudProviderId);
}

// ── 文本服务商 provision ──────────────────────────────────────────────────

/**
 * 保证本地存在一个 "Lumos Cloud" provider, 并在 /v1/models 可达时刷新其模型列表。
 *
 * - 每次登录: api_key 覆写; /v1/models 成功时刷新 catalog。
 * - default_provider_id 仅在缺失 / 已删时写入 (参见 ensureDefaultProviderFallback)。
 * - /v1/models 失败且已有 provider: 保留持久化 catalog, 只刷新 key。
 * - /v1/models 失败且首次创建: 用 CLOUD_FALLBACK_MODEL_CATALOG 兜底。
 */
export async function provisionCloudProvider(apiKey: string): Promise<string> {
  const { getDb } = await import('@/lib/db/connection');
  const db = getDb();

  const remoteModels = await fetchCloudAvailableModels(CLOUD_API_BASE, apiKey);
  const hasRemoteModels = remoteModels.length > 0;
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  const existing = db.prepare(
    "SELECT id FROM api_providers WHERE name = ? AND provider_origin = 'system'",
  ).get(CLOUD_PROVIDER_NAME) as { id: string } | undefined;

  if (existing) {
    if (hasRemoteModels) {
      db.prepare(
        'UPDATE api_providers SET api_key = ?, model_catalog = ?, model_catalog_source = ?, model_catalog_updated_at = ?, updated_at = ? WHERE id = ?',
      ).run(apiKey, JSON.stringify(remoteModels), 'detected', now, now, existing.id);
    } else {
      db.prepare(
        'UPDATE api_providers SET api_key = ?, updated_at = ? WHERE id = ?',
      ).run(apiKey, now, existing.id);
    }
    ensureDefaultProviderFallback(db, existing.id);
    return existing.id;
  }

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
    notes: 'Lumos Cloud 内置服务商, 由登录自动配置',
  });

  ensureDefaultProviderFallback(db, provider.id);
  return provider.id;
}

// ── 图片服务商 provision ──────────────────────────────────────────────────

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
    notes: `Lumos Cloud 内置图片服务商, 由登录自动配置。默认模型: ${config.default_model}`,
  };
}

async function cleanupProvisionedImageProvider(db: DbLike, storedId: string): Promise<void> {
  const { deleteProvider } = await import('@/lib/db/providers');
  try { deleteProvider(storedId); } catch { /* already gone */ }
  db.prepare('DELETE FROM settings WHERE key = ?').run(CLOUD_IMAGE_PROVIDER_ID_SETTING);
  db.prepare("DELETE FROM settings WHERE key = 'provider_override:image'").run();
}

/**
 * 按管理端配置 provision / update / 删除云端图片 provider。
 *
 * - `config=null` → 删除之前配好的图片 provider, 并清掉 `provider_override:image`。
 * - `config` 存在 → upsert (system origin, image-gen 能力),
 *   并把 `provider_override:image` 指向它。
 * Identity: 本地 provider id 持久化在 settings.lumos_cloud_image_provider_id,
 * 所以管理端改名不会丢失对应关系。
 */
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
