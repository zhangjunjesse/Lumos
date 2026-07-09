/**
 * Lumos Cloud 本地 provider 的 upsert / 清理。
 *
 * 运行时只在 API 路由服务端调用。对 DB 的依赖通过 `DbLike` 最小接口表达,
 * 既可以直接传 better-sqlite3 的 Database, 也可以在单测中 duck-type 一个 mock,
 * 因此不需要任何 `any`。
 */
import { fetchCloudAvailableModels } from '@/lib/lumos-cloud-models';
import type {
  CloudChatProviderConfig,
  CloudImageProviderConfig,
  CloudSpeechProviderConfig,
  CloudVideoProviderConfig,
} from './types';

const CLOUD_API_BASE = process.env.LUMOS_API_URL || 'https://api.miki.zj.cn';
const CLOUD_PROVIDER_NAME = 'Lumos Cloud';

/** settings key: JSON map from remote provider id → local provider id. */
const CLOUD_IMAGE_PROVIDERS_MAP_SETTING = 'lumos_cloud_image_providers_map';
/** settings key: remote provider id → local provider id for the single-provider era. */
const LEGACY_IMAGE_PROVIDER_ID_SETTING = 'lumos_cloud_image_provider_id';
const PROVIDER_OVERRIDE_IMAGE_KEY = 'provider_override:image';
const CLOUD_VIDEO_PROVIDERS_MAP_SETTING = 'lumos_cloud_video_providers_map';
const PROVIDER_OVERRIDE_VIDEO_KEY = 'provider_override:video';

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
  all(...params: unknown[]): unknown[];
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
  /** Carries admin-side defaults like LUMOS_DEFAULT_MODEL so the desktop
   *  consumer (generate.ts / billing) can pick them up via
   *  getProviderEffectiveDefaultModel — same shape as chat providers. */
  extra_env: string;
  model_catalog: string;
  notes: string;
}

/**
 * Mirror chat 路径的 LUMOS_DEFAULT_MODEL 注入。Image 不需要 channel id,
 * 所以这里只关心 default_model。空值返回 '{}' 保持 extra_env 干净。
 */
function buildImageProviderExtraEnv(defaultModel?: string | null): string {
  const env: Record<string, string> = {};
  const normalized = defaultModel?.trim() || '';
  if (normalized) env.LUMOS_DEFAULT_MODEL = normalized;
  return Object.keys(env).length > 0 ? JSON.stringify(env) : '{}';
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
    extra_env: buildImageProviderExtraEnv(config.default_model),
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
 * 删除所有 `provider_origin='system'` 且命中 capability 但未被 managed map
 * 追踪的 row。用于擦除旧版 provisioner（如单条 "Lumos Cloud"）遗留的本地
 * orphan，以及任何 map-absorb 流程漏掉的残留条目。
 */
async function removeOrphanSystemProviders(
  db: DbLike,
  capability: 'agent-chat' | 'image-gen' | 'video-gen',
  managedLocalIds: Set<string>,
): Promise<void> {
  const rows = db.prepare(
    "SELECT id, capabilities FROM api_providers WHERE provider_origin = 'system'",
  ).all() as Array<{ id: string; capabilities: string }>;
  const orphans: string[] = [];
  for (const row of rows) {
    if (managedLocalIds.has(row.id)) continue;
    try {
      const caps = JSON.parse(row.capabilities);
      if (Array.isArray(caps) && caps.includes(capability)) orphans.push(row.id);
    } catch {
      /* malformed capabilities — skip */
    }
  }
  if (orphans.length === 0) return;
  const { deleteProvider } = await import('@/lib/db/providers');
  for (const id of orphans) {
    try { deleteProvider(id); } catch (e) {
      console.warn('[cloud-provisioner] failed to delete orphan system provider:', e);
    }
  }
}

/**
 * 全量同步 Lumos Cloud 下发的图片服务商列表到本地。
 *
 * - 入参空数组 → 删除所有已 provision 的云图片 provider, 清掉 map 和 override。
 * - 入参非空 → 按 `remote_id` 一对一 upsert 本地 provider; 原来在 map 中但
 *   新列表里没有的 → 删除。
 * - `provider_override:image` 的维护(用户选择优先, `is_default` 仅做兜底):
 *    - 旧值仍指向 map 内的合法 local id → 保留(用户的手动选择不被周期同步覆盖)。
 *    - 否则若入参里有 `is_default=true` → 用它兜底, 让全新用户/失效 override
 *      的用户有可用默认。
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
    await removeOrphanSystemProviders(db, 'image-gen', new Set());
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
  await removeOrphanSystemProviders(db, 'image-gen', new Set(Object.values(nextMap)));

  const currentOverrideRow = db.prepare('SELECT value FROM settings WHERE key = ?')
    .get(PROVIDER_OVERRIDE_IMAGE_KEY) as { value: string } | undefined;
  const currentOverride = currentOverrideRow?.value?.trim() ?? '';
  const overrideStillValid = currentOverride
    && Object.values(nextMap).includes(currentOverride);

  if (overrideStillValid) {
    // 用户已经选了一个仍然合法的 provider, 不要被周期同步覆盖。
  } else if (defaultLocalId) {
    // 旧 override 缺失或已失效, 用云端 is_default 兜底。
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(PROVIDER_OVERRIDE_IMAGE_KEY, defaultLocalId);
  } else {
    // 既没有合法旧值, 也没有云端默认 → 清空, 让用户重新选择。
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

// ── 视频服务商 provision (多条) ───────────────────────────────────────────

interface VideoProviderUpsertFields {
  name: string;
  provider_type: string;
  api_protocol: 'anthropic-messages' | 'openai-compatible';
  capabilities: string;
  provider_origin: 'system';
  auth_mode: 'api_key';
  base_url: string;
  api_key: string;
  extra_env: string;
  model_catalog: string;
  notes: string;
}

function buildVideoProviderFields(config: CloudVideoProviderConfig): VideoProviderUpsertFields {
  const apiProtocol = config.api_protocol === 'anthropic-messages' ? 'anthropic-messages' : 'openai-compatible';
  return {
    name: config.name,
    provider_type: config.provider_type,
    api_protocol: apiProtocol,
    capabilities: JSON.stringify(['video-gen']),
    provider_origin: 'system',
    auth_mode: 'api_key',
    base_url: config.base_url,
    api_key: config.api_key,
    extra_env: buildImageProviderExtraEnv(config.default_model),
    model_catalog: JSON.stringify(config.model_catalog || []),
    notes: `Lumos Cloud 内置视频服务商 (remote_id=${config.id})。默认模型: ${config.default_model || '(未指定)'}`,
  };
}

function readVideoProvidersMap(db: DbLike): ProviderMap {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?')
    .get(CLOUD_VIDEO_PROVIDERS_MAP_SETTING) as { value: string } | undefined;
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ProviderMap;
    }
  } catch { /* fall through */ }
  return {};
}

function writeVideoProvidersMap(db: DbLike, map: ProviderMap): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(CLOUD_VIDEO_PROVIDERS_MAP_SETTING, JSON.stringify(map));
}

async function upsertOneVideoProvider(
  db: DbLike,
  config: CloudVideoProviderConfig,
  existingLocalId: string | undefined,
): Promise<string> {
  const { createProvider, updateProvider } = await import('@/lib/db/providers');
  const fields = buildVideoProviderFields(config);
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

/**
 * 全量同步 Lumos Cloud 下发的视频服务商列表到本地。
 *
 * 语义与 provisionImageProviders 一致：远端 id 一对一本地 provider；
 * 用户选择仍然优先，远端 is_default 只在旧选择缺失 / 失效时兜底。
 */
export async function provisionVideoProviders(
  configs: CloudVideoProviderConfig[],
): Promise<string[]> {
  const { getDb } = await import('@/lib/db/connection');
  const db = getDb();

  const map = readVideoProvidersMap(db);

  if (configs.length === 0) {
    await removeStaleProviders(db, Object.values(map));
    await removeOrphanSystemProviders(db, 'video-gen', new Set());
    writeVideoProvidersMap(db, {});
    db.prepare('DELETE FROM settings WHERE key = ?').run(PROVIDER_OVERRIDE_VIDEO_KEY);
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
    const localId = await upsertOneVideoProvider(db, config, existingLocalId);
    nextMap[config.id] = localId;
    if (config.is_default) defaultLocalId = localId;
  }
  writeVideoProvidersMap(db, nextMap);
  await removeOrphanSystemProviders(db, 'video-gen', new Set(Object.values(nextMap)));

  const currentOverrideRow = db.prepare('SELECT value FROM settings WHERE key = ?')
    .get(PROVIDER_OVERRIDE_VIDEO_KEY) as { value: string } | undefined;
  const currentOverride = currentOverrideRow?.value?.trim() ?? '';
  const overrideStillValid = currentOverride
    && Object.values(nextMap).includes(currentOverride);

  if (overrideStillValid) {
    // 用户已经选了一个仍然合法的 provider, 不要被周期同步覆盖。
  } else if (defaultLocalId) {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(PROVIDER_OVERRIDE_VIDEO_KEY, defaultLocalId);
  } else {
    db.prepare('DELETE FROM settings WHERE key = ?').run(PROVIDER_OVERRIDE_VIDEO_KEY);
  }

  return Object.values(nextMap);
}

export function getRemoteVideoProviderId(db: DbLike, localProviderId: string): string | null {
  const map = readVideoProvidersMap(db);
  for (const [remoteId, localId] of Object.entries(map)) {
    if (localId === localProviderId) return remoteId;
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
  extra_env: string;
  model_catalog: string;
  notes: string;
}

/**
 * 把云端下发的 newapi_channel_id 注入本地 provider 的 extra_env,以便请求路径
 * 同时派生 new-api admin-token 后缀和 `Specific-Channel-Id` 兼容头,精确路由
 * 到对应 channel。无 channel id 时返回空 JSON 对象字符串,避免污染 extra_env。
 */
function buildChatProviderExtraEnv(
  channelId: number | null | undefined,
  defaultModel?: string | null,
): string {
  const env: Record<string, string> = {};
  if (typeof channelId !== 'number' || !Number.isFinite(channelId) || channelId <= 0) {
    // no channel routing
  } else {
    env.LUMOS_UPSTREAM_CHANNEL_ID = String(channelId);
  }
  const normalizedDefaultModel = defaultModel?.trim() || '';
  if (normalizedDefaultModel) {
    env.LUMOS_DEFAULT_MODEL = normalizedDefaultModel;
  }
  return Object.keys(env).length > 0 ? JSON.stringify(env) : '{}';
}

function buildChatProviderFields(config: CloudChatProviderConfig): ChatProviderUpsertFields {
  // 兼容 lumos-web 后台填写的多种 anthropic 协议变体:'anthropic-messages'
  // (规范名)、'anthropic' (历史/简写)、'claude' (按厂牌名)。这三种都意味着
  // 上游说 anthropic 协议,桌面端 text-generator 应走 createAnthropic 拼
  // /v1/messages,而不是 fallback 到 createOpenAI 的 /chat/completions
  // (后者要求 base_url 自带 /v1,跟 new-api 入口不匹配)。其它值统一落到
  // openai-compatible,跟之前行为一致。
  const rawProtocol = (config.api_protocol || '').trim().toLowerCase();
  const apiProtocol = (rawProtocol === 'anthropic-messages' || rawProtocol === 'anthropic' || rawProtocol === 'claude')
    ? 'anthropic-messages'
    : 'openai-compatible';
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
    extra_env: buildChatProviderExtraEnv(config.newapi_channel_id, config.default_model),
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
 * - default_provider_id 只在首次缺失或指向已删除 provider 时使用云端默认兜底。
 *   用户在桌面端切换到其它 system provider 后，后续云端同步不得覆盖该选择。
 */
export async function provisionChatProviders(
  configs: CloudChatProviderConfig[],
): Promise<string[]> {
  const { getDb } = await import('@/lib/db/connection');
  const db = getDb();

  const map = readChatProvidersMap(db);

  if (configs.length === 0) {
    await removeStaleProviders(db, Object.values(map));
    await removeOrphanSystemProviders(db, 'agent-chat', new Set());
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
  await removeOrphanSystemProviders(db, 'agent-chat', new Set(Object.values(nextMap)));

  if (defaultLocalId) {
    ensureDefaultProviderFallback(db, defaultLocalId);
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

// ── 语音服务商 provision (多条) ───────────────────────────────────────────

const CLOUD_SPEECH_PROVIDERS_MAP_SETTING = 'lumos_cloud_speech_providers_map';
const PROVIDER_OVERRIDE_SPEECH_KEY = 'provider_override:speech';

interface SpeechProviderUpsertFields {
  name: string;
  provider_type: string;
  api_protocol: 'openai-compatible';
  capabilities: string;
  provider_origin: 'system';
  auth_mode: 'api_key';
  base_url: string;
  /** Always empty — desktop never speaks volcengine HTTP directly. The
   *  cloud proxy holds the real key. We keep the column non-null with
   *  a sentinel so downstream UI can show "通过 Lumos 云端代理调用". */
  api_key: string;
  /** JSON {price_per_second, resource_id, default_model} for UI display. */
  extra_env: string;
  notes: string;
}

function buildSpeechProviderExtraEnv(config: CloudSpeechProviderConfig): string {
  const env: Record<string, string> = {};
  if (typeof config.price_per_second === 'number' && Number.isFinite(config.price_per_second)) {
    env.LUMOS_SPEECH_PRICE_PER_SECOND = String(config.price_per_second);
  }
  if (config.resource_id) env.LUMOS_SPEECH_RESOURCE_ID = config.resource_id;
  if (config.default_model) env.LUMOS_DEFAULT_MODEL = config.default_model;
  return Object.keys(env).length > 0 ? JSON.stringify(env) : '{}';
}

function buildSpeechProviderFields(config: CloudSpeechProviderConfig): SpeechProviderUpsertFields {
  const priceMin = config.price_per_second != null
    ? `${(config.price_per_second * 60).toFixed(4)} 元/分钟`
    : '价格待 lumos-web 下发';
  return {
    name: config.name,
    provider_type: config.provider_type,
    api_protocol: 'openai-compatible',
    capabilities: JSON.stringify(['speech']),
    provider_origin: 'system',
    auth_mode: 'api_key',
    base_url: 'https://api.miki.zj.cn/api/cloud/speech',
    api_key: '__lumos_cloud_proxy__',
    extra_env: buildSpeechProviderExtraEnv(config),
    notes: `Lumos Cloud 内置语音服务商 (remote_id=${config.id})。${priceMin}。所有调用通过 lumos-web /api/cloud/speech 代理，密钥不下发桌面端。`,
  };
}

function readSpeechProvidersMap(db: DbLike): ProviderMap {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?')
    .get(CLOUD_SPEECH_PROVIDERS_MAP_SETTING) as { value: string } | undefined;
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ProviderMap;
    }
  } catch { /* fall through */ }
  return {};
}

function writeSpeechProvidersMap(db: DbLike, map: ProviderMap): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(CLOUD_SPEECH_PROVIDERS_MAP_SETTING, JSON.stringify(map));
}

async function upsertOneSpeechProvider(
  db: DbLike,
  config: CloudSpeechProviderConfig,
  existingLocalId: string | undefined,
): Promise<string> {
  const { createProvider, updateProvider } = await import('@/lib/db/providers');
  const fields = buildSpeechProviderFields(config);
  if (existingLocalId) {
    const exists = db.prepare('SELECT id FROM api_providers WHERE id = ?').get(existingLocalId);
    if (exists) {
      updateProvider(existingLocalId, fields);
      return existingLocalId;
    }
  }
  const created = createProvider({ ...fields, model_catalog: '[]', model_catalog_source: 'default' });
  return created.id;
}

async function removeOrphanSystemSpeechProviders(
  db: DbLike,
  managedLocalIds: Set<string>,
): Promise<void> {
  const rows = db.prepare(
    "SELECT id, capabilities FROM api_providers WHERE provider_origin = 'system'",
  ).all() as Array<{ id: string; capabilities: string }>;
  const orphans: string[] = [];
  for (const row of rows) {
    if (managedLocalIds.has(row.id)) continue;
    try {
      const caps = JSON.parse(row.capabilities);
      if (Array.isArray(caps) && caps.includes('speech')) orphans.push(row.id);
    } catch { /* malformed capabilities — skip */ }
  }
  if (orphans.length === 0) return;
  const { deleteProvider } = await import('@/lib/db/providers');
  for (const id of orphans) {
    try { deleteProvider(id); } catch (e) {
      console.warn('[cloud-provisioner] failed to delete orphan speech provider:', e);
    }
  }
}

/**
 * 全量同步 Lumos Cloud 下发的语音服务商列表到本地。
 *
 * 镜像 provisionImageProviders 行为：
 * - 入参空数组 → 删除所有已 provision 的云语音 provider, 清掉 map 和 override。
 * - 入参非空 → 按 `remote_id` 一对一 upsert; 旧 map 中但新列表里没有的 → 删除。
 * - `provider_override:speech` 维护：用户手动选择优先, `is_default` 兜底。
 */
export async function provisionSpeechProviders(
  configs: CloudSpeechProviderConfig[],
): Promise<string[]> {
  const { getDb } = await import('@/lib/db/connection');
  const db = getDb();

  const map = readSpeechProvidersMap(db);

  if (configs.length === 0) {
    await removeStaleProviders(db, Object.values(map));
    await removeOrphanSystemSpeechProviders(db, new Set());
    writeSpeechProvidersMap(db, {});
    db.prepare('DELETE FROM settings WHERE key = ?').run(PROVIDER_OVERRIDE_SPEECH_KEY);
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
    const localId = await upsertOneSpeechProvider(db, config, existingLocalId);
    nextMap[config.id] = localId;
    if (config.is_default) defaultLocalId = localId;
  }
  writeSpeechProvidersMap(db, nextMap);
  await removeOrphanSystemSpeechProviders(db, new Set(Object.values(nextMap)));

  const currentOverrideRow = db.prepare('SELECT value FROM settings WHERE key = ?')
    .get(PROVIDER_OVERRIDE_SPEECH_KEY) as { value: string } | undefined;
  const currentOverride = currentOverrideRow?.value?.trim() ?? '';
  const overrideStillValid = currentOverride
    && Object.values(nextMap).includes(currentOverride);

  if (overrideStillValid) {
    // 用户已经选了一个仍然合法的 provider, 不要被周期同步覆盖。
  } else if (defaultLocalId) {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(PROVIDER_OVERRIDE_SPEECH_KEY, defaultLocalId);
  } else {
    db.prepare('DELETE FROM settings WHERE key = ?').run(PROVIDER_OVERRIDE_SPEECH_KEY);
  }

  return Object.values(nextMap);
}

/**
 * Resolve the remote provider id for a local speech api_provider id.
 * Used by cloud-speech adapter when calling /api/cloud/speech/transcribe.
 */
export function getRemoteSpeechProviderId(db: DbLike, localProviderId: string): string | null {
  const map = readSpeechProvidersMap(db);
  for (const [remoteId, localId] of Object.entries(map)) {
    if (localId === localProviderId) return remoteId;
  }
  return null;
}
