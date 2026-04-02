import crypto from 'crypto';
import type {
  ApiProvider,
  CreateProviderRequest,
  ProviderCapability,
  ProviderModelCatalogSource,
  UpdateProviderRequest,
} from '@/types';
import {
  providerSupportsCapability,
  resolveProviderPersistenceFields,
} from '../provider-config';
import { getDb } from './connection';

const DEFAULT_PROVIDER_SETTING_KEY = 'default_provider_id';
const WORKFLOW_OVERRIDE_SETTING_KEY = 'provider_override:workflow';
const KNOWLEDGE_OVERRIDE_SETTING_KEY = 'provider_override:knowledge';
const IMAGE_OVERRIDE_SETTING_KEY = 'provider_override:image';
const MEMORY_INTELLIGENCE_PROVIDER_SETTING_KEY = 'memory_intelligence_provider_id';

export class ProviderDeletionBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderDeletionBlockedError';
  }
}

export class ProviderUpdateBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUpdateBlockedError';
  }
}

export class ProviderActivationBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderActivationBlockedError';
  }
}

export class ProviderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderValidationError';
  }
}

type ProviderReferenceRule = {
  key: string;
  label: string;
  capability: ProviderCapability;
  disallowLocalAuth?: boolean;
  requiredApiProtocol?: ApiProvider['api_protocol'];
};

const PROVIDER_UPDATE_REFERENCE_RULES: ProviderReferenceRule[] = [
  {
    key: DEFAULT_PROVIDER_SETTING_KEY,
    label: '默认服务商',
    capability: 'agent-chat',
  },
  {
    key: WORKFLOW_OVERRIDE_SETTING_KEY,
    label: '工作流规划服务商',
    capability: 'text-gen',
  },
  {
    key: KNOWLEDGE_OVERRIDE_SETTING_KEY,
    label: '知识库模块服务商',
    capability: 'text-gen',
    disallowLocalAuth: true,
  },
  {
    key: IMAGE_OVERRIDE_SETTING_KEY,
    label: '图片模块服务商',
    capability: 'image-gen',
  },
  {
    key: MEMORY_INTELLIGENCE_PROVIDER_SETTING_KEY,
    label: '记忆智能服务商',
    capability: 'text-gen',
    disallowLocalAuth: true,
  },
];

function normalizeModelCatalogSource(
  modelCatalog: string | undefined,
  source?: ProviderModelCatalogSource | string | null,
): ProviderModelCatalogSource {
  if (source === 'manual' || source === 'detected' || source === 'default') {
    return source;
  }

  const normalizedCatalog = modelCatalog?.trim() || '';
  if (!normalizedCatalog || normalizedCatalog === '[]') {
    return 'default';
  }

  return 'manual';
}

function setDefaultProviderSetting(db: ReturnType<typeof getDb>, providerId: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(DEFAULT_PROVIDER_SETTING_KEY, providerId);
}

function clearDefaultProviderSetting(db: ReturnType<typeof getDb>): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(DEFAULT_PROVIDER_SETTING_KEY);
}

function syncActiveProviderFlags(
  db: ReturnType<typeof getDb>,
  activeProviderId?: string,
): void {
  db.prepare('UPDATE api_providers SET is_active = 0').run();
  if (activeProviderId) {
    db.prepare('UPDATE api_providers SET is_active = 1 WHERE id = ?').run(activeProviderId);
  }
}

function describeCapability(capability: ProviderCapability): string {
  switch (capability) {
    case 'agent-chat':
      return '主聊天/Agent';
    case 'text-gen':
      return '文本生成';
    case 'image-gen':
      return '图片生成';
    case 'embedding':
      return '向量嵌入';
    default:
      return capability;
  }
}

function isProviderReferencedBySetting(
  db: ReturnType<typeof getDb>,
  settingKey: string,
  providerId: string,
): boolean {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(settingKey) as { value?: string } | undefined;
  return row?.value === providerId;
}

function assertProviderMatchesReferenceRule(
  provider: ApiProvider,
  rule: ProviderReferenceRule,
): void {
  if (!providerSupportsCapability(provider, rule.capability)) {
    throw new ProviderUpdateBlockedError(
      `${rule.label}仍指向当前配置，必须继续支持${describeCapability(rule.capability)}，请先切换引用后再修改`,
    );
  }

  if (rule.disallowLocalAuth && provider.auth_mode === 'local_auth') {
    throw new ProviderUpdateBlockedError(
      `${rule.label}当前不支持 local_auth，请先切换引用后再修改`,
    );
  }

  if (rule.requiredApiProtocol && provider.api_protocol !== rule.requiredApiProtocol) {
    throw new ProviderUpdateBlockedError(
      `${rule.label}当前仅支持 ${rule.requiredApiProtocol} 协议，请先切换引用后再修改`,
    );
  }
}

function assertProviderUpdateKeepsReferencesValid(
  db: ReturnType<typeof getDb>,
  providerId: string,
  nextProvider: ApiProvider,
): void {
  for (const rule of PROVIDER_UPDATE_REFERENCE_RULES) {
    if (!isProviderReferencedBySetting(db, rule.key, providerId)) {
      continue;
    }
    assertProviderMatchesReferenceRule(nextProvider, rule);
  }

  const sessionRef = db.prepare(
    'SELECT COUNT(*) as count FROM chat_sessions WHERE provider_id = ?'
  ).get(providerId) as { count?: number } | undefined;
  const sessionCount = Number(sessionRef?.count || 0);
  if (sessionCount > 0 && !providerSupportsCapability(nextProvider, 'agent-chat')) {
    throw new ProviderUpdateBlockedError(
      `当前配置仍被 ${sessionCount} 个聊天会话引用，必须继续支持主聊天/Agent，请先切换会话或改用新配置`,
    );
  }
}

function assertProviderConnectionFieldsValid(provider: Pick<ApiProvider, 'name' | 'provider_type' | 'api_protocol' | 'auth_mode' | 'base_url'>): void {
  if (provider.auth_mode === 'local_auth') {
    return;
  }

  const normalizedBaseUrl = provider.base_url.trim();
  if (
    provider.api_protocol === 'anthropic-messages'
    && provider.provider_type === 'custom'
    && !normalizedBaseUrl
  ) {
    throw new ProviderValidationError(
      `服务商“${provider.name}”使用自定义 Anthropic 兼容协议时必须填写 base_url`,
    );
  }

  if (
    provider.api_protocol === 'openai-compatible'
    && provider.provider_type !== 'openrouter'
    && provider.provider_type !== 'gemini-image'
    && !normalizedBaseUrl
  ) {
    throw new ProviderValidationError(
      `服务商“${provider.name}”使用 OpenAI 兼容协议时必须填写 base_url`,
    );
  }
}

// ==========================================
// API Provider Operations
// ==========================================

export function getAllProviders(): ApiProvider[] {
  const db = getDb();
  return db.prepare('SELECT * FROM api_providers ORDER BY sort_order ASC, created_at ASC').all() as ApiProvider[];
}

export function getProvider(id: string): ApiProvider | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM api_providers WHERE id = ?').get(id) as ApiProvider | undefined;
}

/**
 * @deprecated Use getDefaultProvider() instead. This function reads `is_active`
 * which is no longer the truth source for "current provider". Kept only for
 * backward-compatible migration paths.
 */
export function getActiveProvider(): ApiProvider | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM api_providers WHERE is_active = 1 LIMIT 1').get() as ApiProvider | undefined;
}

/**
 * Get the global default provider via `settings.default_provider_id`.
 * This is the single truth source for "which provider is currently in use".
 */
export function getDefaultProvider(): ApiProvider | undefined {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'default_provider_id'").get() as { value: string } | undefined;
  if (row?.value) {
    const provider = db.prepare('SELECT * FROM api_providers WHERE id = ?').get(row.value) as ApiProvider | undefined;
    if (provider) return provider;
  }
  return undefined;
}

export function createProvider(data: CreateProviderRequest): ApiProvider {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  const maxRow = db.prepare('SELECT MAX(sort_order) as max_order FROM api_providers').get() as { max_order: number | null };
  const sortOrder = (maxRow.max_order ?? -1) + 1;
  const modelCatalog = data.model_catalog || '[]';
  const modelCatalogSource = normalizeModelCatalogSource(modelCatalog, data.model_catalog_source);
  const modelCatalogUpdatedAt = data.model_catalog_updated_at
    ?? (modelCatalogSource === 'default' ? null : now);
  const fields = resolveProviderPersistenceFields({
    providerType: data.provider_type,
    apiProtocol: data.api_protocol,
    capabilities: data.capabilities,
    providerOrigin: data.provider_origin,
    authMode: data.auth_mode,
  });
  const nextProvider: ApiProvider = {
    id,
    name: data.name,
    provider_type: fields.providerType,
    api_protocol: fields.apiProtocol,
    capabilities: fields.capabilities,
    provider_origin: fields.providerOrigin,
    auth_mode: fields.authMode,
    base_url: data.base_url || '',
    api_key: data.api_key || '',
    is_active: 0,
    sort_order: sortOrder,
    extra_env: data.extra_env || '{}',
    model_catalog: modelCatalog,
    model_catalog_source: modelCatalogSource,
    model_catalog_updated_at: modelCatalogUpdatedAt,
    notes: data.notes || '',
    is_builtin: 0,
    user_modified: 0,
    created_at: now,
    updated_at: now,
  };

  assertProviderConnectionFieldsValid(nextProvider);

  db.prepare(
    'INSERT INTO api_providers (id, name, provider_type, api_protocol, capabilities, provider_origin, auth_mode, base_url, api_key, is_active, sort_order, extra_env, model_catalog, model_catalog_source, model_catalog_updated_at, notes, is_builtin, user_modified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.name,
    fields.providerType,
    fields.apiProtocol,
    fields.capabilities,
    fields.providerOrigin,
    fields.authMode,
    data.base_url || '',
    data.api_key || '',
    0,
    sortOrder,
    data.extra_env || '{}',
    modelCatalog,
    modelCatalogSource,
    modelCatalogUpdatedAt,
    data.notes || '',
    0,
    0,
    now,
    now,
  );

  return getProvider(id)!;
}

export function cloneProvider(id: string, name: string): ApiProvider | undefined {
  const db = getDb();
  const existing = getProvider(id);
  if (!existing) return undefined;

  const nextId = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const maxRow = db.prepare('SELECT MAX(sort_order) as max_order FROM api_providers').get() as { max_order: number | null };
  const sortOrder = (maxRow.max_order ?? -1) + 1;
  const fields = resolveProviderPersistenceFields({
    providerType: existing.provider_type,
    apiProtocol: existing.api_protocol,
    capabilities: existing.capabilities,
    providerOrigin: 'custom',
    authMode: existing.auth_mode,
  });

  db.prepare(
    'INSERT INTO api_providers (id, name, provider_type, api_protocol, capabilities, provider_origin, auth_mode, base_url, api_key, is_active, sort_order, extra_env, model_catalog, model_catalog_source, model_catalog_updated_at, notes, is_builtin, user_modified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    nextId,
    name,
    fields.providerType,
    fields.apiProtocol,
    fields.capabilities,
    fields.providerOrigin,
    fields.authMode,
    existing.base_url,
    existing.api_key,
    0,
    sortOrder,
    existing.extra_env || '{}',
    existing.model_catalog || '[]',
    normalizeModelCatalogSource(existing.model_catalog, existing.model_catalog_source),
    existing.model_catalog_updated_at || null,
    existing.notes || '',
    0,
    0,
    now,
    now,
  );

  return getProvider(nextId);
}

export function updateProvider(id: string, data: UpdateProviderRequest): ApiProvider | undefined {
  const db = getDb();
  const existing = getProvider(id);
  if (!existing) return undefined;

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const name = data.name ?? existing.name;
  const providerFields = resolveProviderPersistenceFields({
    providerType: data.provider_type ?? existing.provider_type,
    apiProtocol: data.api_protocol ?? existing.api_protocol,
    capabilities: data.capabilities ?? existing.capabilities,
    providerOrigin: data.provider_origin ?? existing.provider_origin,
    authMode: data.auth_mode ?? existing.auth_mode,
    isBuiltin: existing.is_builtin,
  });
  const providerType = providerFields.providerType;
  const baseUrl = data.base_url ?? existing.base_url;
  const apiKey = data.api_key ?? existing.api_key;
  const extraEnv = data.extra_env ?? existing.extra_env;
  const modelCatalog = data.model_catalog ?? existing.model_catalog;
  const modelCatalogChanged = data.model_catalog !== undefined && data.model_catalog !== existing.model_catalog;
  const modelCatalogSource = modelCatalogChanged
    ? normalizeModelCatalogSource(modelCatalog, data.model_catalog_source)
    : normalizeModelCatalogSource(modelCatalog, data.model_catalog_source ?? existing.model_catalog_source);
  const modelCatalogUpdatedAt = modelCatalogChanged
    ? (data.model_catalog_updated_at ?? now)
    : (data.model_catalog_updated_at ?? existing.model_catalog_updated_at ?? null);
  const notes = data.notes ?? existing.notes;
  const sortOrder = data.sort_order ?? existing.sort_order;
  const isActive = existing.is_active;

  // If this is a builtin provider, mark it as user_modified
  const userModified = existing.is_builtin ? 1 : existing.user_modified;
  const nextProvider: ApiProvider = {
    ...existing,
    name,
    provider_type: providerType,
    api_protocol: providerFields.apiProtocol,
    capabilities: providerFields.capabilities,
    provider_origin: providerFields.providerOrigin,
    auth_mode: providerFields.authMode,
    base_url: baseUrl,
    api_key: apiKey,
    extra_env: extraEnv,
    model_catalog: modelCatalog,
    model_catalog_source: modelCatalogSource,
    model_catalog_updated_at: modelCatalogUpdatedAt,
    notes,
    sort_order: sortOrder,
    is_active: isActive,
    user_modified: userModified,
    updated_at: now,
  };

  assertProviderConnectionFieldsValid(nextProvider);
  assertProviderUpdateKeepsReferencesValid(db, id, nextProvider);

  const transaction = db.transaction(() => {
    db.prepare(
      'UPDATE api_providers SET name = ?, provider_type = ?, api_protocol = ?, capabilities = ?, provider_origin = ?, auth_mode = ?, base_url = ?, api_key = ?, extra_env = ?, model_catalog = ?, model_catalog_source = ?, model_catalog_updated_at = ?, notes = ?, sort_order = ?, is_active = ?, user_modified = ?, updated_at = ? WHERE id = ?'
    ).run(
      name,
      providerType,
      providerFields.apiProtocol,
      providerFields.capabilities,
      providerFields.providerOrigin,
      providerFields.authMode,
      baseUrl,
      apiKey,
      extraEnv,
      modelCatalog,
      modelCatalogSource,
      modelCatalogUpdatedAt,
      notes,
      sortOrder,
      isActive,
      userModified,
      now,
      id,
    );
  });

  transaction();

  return getProvider(id);
}

export function deleteProvider(id: string): boolean {
  const db = getDb();
  const existing = getProvider(id);
  if (!existing) return false;
  const defaultProvider = db.prepare('SELECT value FROM settings WHERE key = ?').get(DEFAULT_PROVIDER_SETTING_KEY) as { value?: string } | undefined;
  const overrideRefs = db.prepare(
    "SELECT key FROM settings WHERE value = ? AND key LIKE 'provider_override:%' ORDER BY key ASC"
  ).all(id) as Array<{ key: string }>;

  if (defaultProvider?.value === id) {
    throw new ProviderDeletionBlockedError('当前配置仍是默认服务商，请先切换默认服务商后再删除');
  }

  if (overrideRefs.length > 0) {
    const modules = overrideRefs
      .map((row) => row.key.replace('provider_override:', '').trim())
      .filter(Boolean)
      .join('、');
    throw new ProviderDeletionBlockedError(`当前配置仍被模块覆盖引用（${modules}），请先调整对应模块配置后再删除`);
  }

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM api_providers WHERE id = ?').run(id);
  });

  transaction();
  return true;
}

export function activateProvider(id: string): boolean {
  const db = getDb();
  const existing = getProvider(id);
  if (!existing) return false;
  if (!providerSupportsCapability(existing, 'agent-chat')) {
    throw new ProviderActivationBlockedError('当前配置不支持主聊天/Agent，不能设为默认服务商');
  }

  const transaction = db.transaction(() => {
    setDefaultProviderSetting(db, id);
    syncActiveProviderFlags(db, id);
  });
  transaction();
  return true;
}

export function deactivateAllProviders(): void {
  const db = getDb();
  const transaction = db.transaction(() => {
    clearDefaultProviderSetting(db);
    syncActiveProviderFlags(db);
  });
  transaction();
}

export function getBuiltinProvider(): ApiProvider | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM api_providers WHERE is_builtin = 1 LIMIT 1').get() as ApiProvider | undefined;
}

export function resetBuiltinProvider(): ApiProvider | undefined {
  const db = getDb();
  const builtin = getBuiltinProvider();
  if (!builtin) return undefined;
  const isDefaultProvider = isProviderReferencedBySetting(db, DEFAULT_PROVIDER_SETTING_KEY, builtin.id);

  const defaultKey = process.env.LUMOS_DEFAULT_API_KEY || process.env.CODEPILOT_DEFAULT_API_KEY;
  const defaultBaseUrl = process.env.CODEPILOT_DEFAULT_BASE_URL || '';

  if (!defaultKey) {
    throw new Error('LUMOS_DEFAULT_API_KEY not found in environment');
  }

  if (process.env.CODEPILOT_DEFAULT_API_KEY && !process.env.LUMOS_DEFAULT_API_KEY) {
    console.warn('[providers] CODEPILOT_DEFAULT_API_KEY is deprecated. Please use LUMOS_DEFAULT_API_KEY instead.');
  }

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const fields = resolveProviderPersistenceFields({
    providerType: 'anthropic',
    apiProtocol: 'anthropic-messages',
    capabilities: ['agent-chat'],
    providerOrigin: 'system',
    authMode: 'api_key',
    isBuiltin: 1,
  });

  const transaction = db.transaction(() => {
    db.prepare(
      'UPDATE api_providers SET name = ?, provider_type = ?, api_protocol = ?, capabilities = ?, provider_origin = ?, auth_mode = ?, base_url = ?, api_key = ?, extra_env = ?, model_catalog = ?, model_catalog_source = ?, model_catalog_updated_at = ?, notes = ?, user_modified = ?, updated_at = ? WHERE id = ?'
    ).run(
      'Built-in',
      fields.providerType,
      fields.apiProtocol,
      fields.capabilities,
      fields.providerOrigin,
      fields.authMode,
      defaultBaseUrl,
      defaultKey,
      '{}',
      '[]',
      'default',
      null,
      'Auto-created from embedded key',
      0,
      now,
      builtin.id,
    );

    if (isDefaultProvider) {
      setDefaultProviderSetting(db, builtin.id);
    }
  });

  transaction();

  return getProvider(builtin.id);
}
