/**
 * Lumos Cloud 本地 provider 的 upsert / 清理。
 *
 * 运行时只在 API 路由服务端调用。对 DB 的依赖通过 `DbLike` 最小接口表达,
 * 既可以直接传 better-sqlite3 的 Database, 也可以在单测中 duck-type 一个 mock,
 * 因此不需要任何 `any`。
 */
import { fetchCloudAvailableModels } from '@/lib/lumos-cloud-models';
import type { CloudChatProviderConfig, CloudImageProviderConfig } from './types';

const CLOUD_API_BASE = process.env.LUMOS_API_URL || 'http://api.miki.zj.cn';
const CLOUD_PROVIDER_NAME = 'Lumos Cloud';

/** settings key: JSON map from remote provider id → local provider id. */
const CLOUD_IMAGE_PROVIDERS_MAP_SETTING = 'lumos_cloud_image_providers_map';
/** settings key: remote provider id → local provider id for the single-provider era. */
const LEGACY_IMAGE_PROVIDER_ID_SETTING = 'lumos_cloud_image_provider_id';
const PROVIDER_OVERRIDE_IMAGE_KEY = 'provider_override:image';

/** settings key: JSON map from remote chat provider id → local api_providers id. */
const CLOUD_CHAT_PROVIDERS_MAP_SETTING = 'lumos_cloud_chat_providers_map';

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

// ── 图片服务商 provision (多条) ───────────────────────────────────────────

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
    notes: `Lumos Cloud 内置图片服务商 (remote_id=${config.id})。默认模型: ${config.default_model || '(未指定)'}`,
  };
}

interface ProviderMap {
  [remoteId: string]: string;
}

function readProvidersMap(db: DbLike): ProviderMap {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?')
    .get(CLOUD_IMAGE_PROVIDERS_MAP_SETTING) as { value: string } | undefined;
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ProviderMap;
    }
  } catch { /* fall through */ }
  return {};
}

function writeProvidersMap(db: DbLike, map: ProviderMap): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(CLOUD_IMAGE_PROVIDERS_MAP_SETTING, JSON.stringify(map));
}

/**
 * 吸收旧版 (单条 provider) 遗留的 settings：把 `lumos_cloud_image_provider_id`
 * 合并进新 map 后删除。只在 map 为空时生效，避免覆盖新逻辑。
 */
function absorbLegacySingleProviderSetting(db: DbLike, map: ProviderMap): ProviderMap {
  if (Object.keys(map).length > 0) return map;
  const legacyRow = db.prepare('SELECT value FROM settings WHERE key = ?')
    .get(LEGACY_IMAGE_PROVIDER_ID_SETTING) as { value: string } | undefined;
  const legacyLocalId = legacyRow?.value?.trim();
  if (legacyLocalId) {
    // We don't know its remote id (legacy didn't track it). Key it with a
    // sentinel so the normal sync-pass can detect "not in new list" and
    // delete it cleanly. No upstream config will ever use this sentinel.
    map['__legacy__'] = legacyLocalId;
  }
  db.prepare('DELETE FROM settings WHERE key = ?').run(LEGACY_IMAGE_PROVIDER_ID_SETTING);
  return map;
}

async function upsertOneImageProvider(
  db: DbLike,
  config: CloudImageProviderConfig,
  existingLocalId: string | undefined,
): Promise<string> {
  const { createProvider, updateProvider } = await import('@/lib/db/providers');
  const fields = buildImageProviderFields(config);
  if (existingLocalId) {
    const exists = db.prepare('SELECT id FROM api_providers WHERE id = ?').get(existingLocalId);
    if (exists) {
      updateProvider(existingLocalId, fields);
      return existingLocalId;
    }
  }
  const created = createProvider({ ...fields, model_catalog_source: 'default' });
  return created.id;
}

async function removeStaleProviders(
  db: DbLike,
  staleLocalIds: string[],
): Promise<void> {
  if (staleLocalIds.length === 0) return;
  const { deleteProvider } = await import('@/lib/db/providers');
  for (const id of staleLocalIds) {
    try { deleteProvider(id); } catch { /* already gone */ }
  }
}

/**
 * 全量同步 Lumos Cloud 下发的图片服务商列表到本地。
 *
 * - 入参空数组 → 删除所有已 provision 的云图片 provider, 清掉 map 和 override。
 * - 入参非空 → 按 `remote_id` 一对一 upsert 本地 provider; 原来在 map 中但
 *   新列表里没有的 → 删除。
 * - `provider_override:image` 的维护:
 *    - 如果入参里有 `is_default=true` → 指向它的 local id。
 *    - 否则若旧值还指向现有 local provider → 保留, 让用户的手动选择生效。
 *    - 否则 → 清空, 让 `resolveProviderForCapability` 报错提醒用户去选择。
 */
export async function provisionImageProviders(
  configs: CloudImageProviderConfig[],
): Promise<string[]> {
  const { getDb } = await import('@/lib/db/connection');
  const db = getDb();

  let map = readProvidersMap(db);
  map = absorbLegacySingleProviderSetting(db, map);

  if (configs.length === 0) {
    await removeStaleProviders(db, Object.values(map));
    writeProvidersMap(db, {});
    db.prepare('DELETE FROM settings WHERE key = ?').run(PROVIDER_OVERRIDE_IMAGE_KEY);
    return [];
  }

  const incomingRemoteIds = new Set(configs.map((c) => c.id));
  const staleLocalIds: string[] = [];
  for (const [remoteId, localId] of Object.entries(map)) {
    if (!incomingRemoteIds.has(remoteId)) staleLocalIds.push(localId);
  }
  await removeStaleProviders(db, staleLocalIds);

  const nextMap: ProviderMap = {};
  let defaultLocalId: string | undefined;
  for (const config of configs) {
    const existingLocalId = map[config.id];
    const localId = await upsertOneImageProvider(db, config, existingLocalId);
    nextMap[config.id] = localId;
    if (config.is_default) defaultLocalId = localId;
  }
  writeProvidersMap(db, nextMap);

  const currentOverrideRow = db.prepare('SELECT value FROM settings WHERE key = ?')
    .get(PROVIDER_OVERRIDE_IMAGE_KEY) as { value: string } | undefined;
  const currentOverride = currentOverrideRow?.value?.trim() ?? '';
  const overrideStillValid = currentOverride
    && Object.values(nextMap).includes(currentOverride);

  if (defaultLocalId) {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(PROVIDER_OVERRIDE_IMAGE_KEY, defaultLocalId);
  } else if (!overrideStillValid) {
    // 没有系统默认, 旧 override 也已失效 → 清空, 让用户重新选择。
    db.prepare('DELETE FROM settings WHERE key = ?').run(PROVIDER_OVERRIDE_IMAGE_KEY);
  }

  return Object.values(nextMap);
}

/**
 * Resolve the remote provider id (lumos-web `lumos_image_providers.id`) for
 * a local api_provider id. Used by image-gen-tool to attribute billing.
 * Returns null if the local provider isn't one of our cloud-provisioned rows.
 *
 * Takes an explicit `DbLike` so callers don't have to bridge the async-only
 * `getDb` dynamic import into a sync hot path.
 */
export function getRemoteImageProviderId(db: DbLike, localProviderId: string): string | null {
  const map = readProvidersMap(db);
  for (const [remoteId, localId] of Object.entries(map)) {
    if (localId === localProviderId && remoteId !== '__legacy__') return remoteId;
  }
  return null;
}

// ── 对话服务商 provision (多条) ───────────────────────────────────────────

interface ChatProviderUpsertFields {
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

function buildChatProviderFields(config: CloudChatProviderConfig): ChatProviderUpsertFields {
  const apiProtocol = config.api_protocol === 'anthropic-messages' ? 'anthropic-messages' : 'openai-compatible';
  const catalog = (config.model_catalog || []).map((m) => ({
    value: m.value,
    label: m.label,
    input_price_per_mtok: m.input_price_per_mtok,
    output_price_per_mtok: m.output_price_per_mtok,
  }));
  return {
    name: config.name,
    provider_type: config.provider_type,
    api_protocol: apiProtocol,
    capabilities: JSON.stringify(['agent-chat']),
    provider_origin: 'system',
    auth_mode: 'api_key',
    base_url: config.base_url,
    api_key: config.api_key,
    model_catalog: JSON.stringify(catalog),
    notes: `Lumos Cloud 内置对话服务商 (remote_id=${config.id})。默认模型: ${config.default_model || '(未指定)'}`,
  };
}

function readChatProvidersMap(db: DbLike): ProviderMap {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?')
    .get(CLOUD_CHAT_PROVIDERS_MAP_SETTING) as { value: string } | undefined;
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ProviderMap;
    }
  } catch { /* fall through */ }
  return {};
}

function writeChatProvidersMap(db: DbLike, map: ProviderMap): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(CLOUD_CHAT_PROVIDERS_MAP_SETTING, JSON.stringify(map));
}

async function upsertOneChatProvider(
  db: DbLike,
  config: CloudChatProviderConfig,
  existingLocalId: string | undefined,
): Promise<string> {
  const { createProvider, updateProvider } = await import('@/lib/db/providers');
  const fields = buildChatProviderFields(config);
  if (existingLocalId) {
    const exists = db.prepare('SELECT id FROM api_providers WHERE id = ?').get(existingLocalId);
    if (exists) {
      updateProvider(existingLocalId, fields);
      return existingLocalId;
    }
  }
  const created = createProvider({ ...fields, model_catalog_source: 'detected' });
  return created.id;
}

/**
 * 全量同步 Lumos Cloud 下发的对话服务商列表到本地 api_providers。
 *
 * - 入参空 → 删除所有已 provision 的云对话 provider，清 map。
 * - 入参非空 → 按 `remote_id` 一对一 upsert。旧的 / 不在新列表里的 → 删除。
 * - 每个 provider 用 `provider_origin='system'`，桌面端 UI 据此锁定为只读。
 * - default_provider_id 只在缺失 / 已失效时才指向"标为默认"的那条；
 *   已生效的用户选择保留不动。
 */
export async function provisionChatProviders(
  configs: CloudChatProviderConfig[],
): Promise<string[]> {
  const { getDb } = await import('@/lib/db/connection');
  const db = getDb();

  const map = readChatProvidersMap(db);

  if (configs.length === 0) {
    await removeStaleProviders(db, Object.values(map));
    writeChatProvidersMap(db, {});
    return [];
  }

  const incomingRemoteIds = new Set(configs.map((c) => c.id));
  const staleLocalIds: string[] = [];
  for (const [remoteId, localId] of Object.entries(map)) {
    if (!incomingRemoteIds.has(remoteId)) staleLocalIds.push(localId);
  }
  await removeStaleProviders(db, staleLocalIds);

  const nextMap: ProviderMap = {};
  let defaultLocalId: string | undefined;
  for (const config of configs) {
    const existingLocalId = map[config.id];
    const localId = await upsertOneChatProvider(db, config, existingLocalId);
    nextMap[config.id] = localId;
    if (config.is_default) defaultLocalId = localId;
  }
  writeChatProvidersMap(db, nextMap);

  if (defaultLocalId) {
    const currentDefaultRow = db.prepare("SELECT value FROM settings WHERE key = 'default_provider_id'")
      .get() as { value?: string } | undefined;
    const currentId = currentDefaultRow?.value?.trim() ?? '';
    const stillValid = currentId
      && db.prepare('SELECT 1 FROM api_providers WHERE id = ?').get(currentId);
    if (!stillValid) {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('default_provider_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(defaultLocalId);
    }
  }

  return Object.values(nextMap);
}

/**
 * Resolve remote chat-provider id given a local api_provider id. Returns null
 * if the local provider isn't one of our cloud-provisioned chat rows.
 */
export function getRemoteChatProviderId(db: DbLike, localProviderId: string): string | null {
  const map = readChatProvidersMap(db);
  for (const [remoteId, localId] of Object.entries(map)) {
    if (localId === localProviderId) return remoteId;
  }
  return null;
}
