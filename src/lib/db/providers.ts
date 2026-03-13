import crypto from 'crypto';
import type {
  ApiProvider,
  CreateProviderRequest,
  ProviderModelCatalogSource,
  UpdateProviderRequest,
} from '@/types';
import { getDb } from './connection';

const DEFAULT_PROVIDER_SETTING_KEY = 'default_provider_id';

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

export function getActiveProvider(): ApiProvider | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM api_providers WHERE is_active = 1 LIMIT 1').get() as ApiProvider | undefined;
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

  db.prepare(
    'INSERT INTO api_providers (id, name, provider_type, base_url, api_key, is_active, sort_order, extra_env, model_catalog, model_catalog_source, model_catalog_updated_at, notes, is_builtin, user_modified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.name,
    data.provider_type || 'anthropic',
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

  db.prepare(
    'INSERT INTO api_providers (id, name, provider_type, base_url, api_key, is_active, sort_order, extra_env, model_catalog, model_catalog_source, model_catalog_updated_at, notes, is_builtin, user_modified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    nextId,
    name,
    existing.provider_type,
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
  const providerType = data.provider_type ?? existing.provider_type;
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
  let isActive = data.is_active ?? existing.is_active;

  // Auto-activate builtin provider when user modifies API key or base_url
  if (existing.is_builtin && existing.is_active === 0) {
    if ((data.api_key && data.api_key.trim() !== '') ||
        (data.base_url !== undefined && data.base_url !== existing.base_url)) {
      isActive = 1;
    }
  }

  // If this is a builtin provider, mark it as user_modified
  const userModified = existing.is_builtin ? 1 : existing.user_modified;

  // If activating this provider, deactivate all others first
  if (isActive === 1 && existing.is_active === 0) {
    db.prepare('UPDATE api_providers SET is_active = 0').run();
  }

  const transaction = db.transaction(() => {
    db.prepare(
      'UPDATE api_providers SET name = ?, provider_type = ?, base_url = ?, api_key = ?, extra_env = ?, model_catalog = ?, model_catalog_source = ?, model_catalog_updated_at = ?, notes = ?, sort_order = ?, is_active = ?, user_modified = ?, updated_at = ? WHERE id = ?'
    ).run(
      name,
      providerType,
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

    if (isActive === 1) {
      setDefaultProviderSetting(db, id);
    } else if (existing.is_active === 1) {
      clearDefaultProviderSetting(db);
    }
  });

  transaction();

  return getProvider(id);
}

export function deleteProvider(id: string): boolean {
  const db = getDb();
  const existing = getProvider(id);
  if (!existing) return false;
  const defaultProvider = db.prepare('SELECT value FROM settings WHERE key = ?').get(DEFAULT_PROVIDER_SETTING_KEY) as { value?: string } | undefined;

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM api_providers WHERE id = ?').run(id);

    if (existing.is_active === 1 || defaultProvider?.value === id) {
      clearDefaultProviderSetting(db);
    }
  });

  transaction();
  return true;
}

export function activateProvider(id: string): boolean {
  const db = getDb();
  const existing = getProvider(id);
  if (!existing) return false;

  const transaction = db.transaction(() => {
    db.prepare('UPDATE api_providers SET is_active = 0').run();
    db.prepare('UPDATE api_providers SET is_active = 1 WHERE id = ?').run(id);
    setDefaultProviderSetting(db, id);
  });
  transaction();
  return true;
}

export function deactivateAllProviders(): void {
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare('UPDATE api_providers SET is_active = 0').run();
    clearDefaultProviderSetting(db);
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

  const defaultKey = process.env.LUMOS_DEFAULT_API_KEY || process.env.CODEPILOT_DEFAULT_API_KEY;
  const defaultBaseUrl = process.env.CODEPILOT_DEFAULT_BASE_URL || '';

  if (!defaultKey) {
    throw new Error('LUMOS_DEFAULT_API_KEY not found in environment');
  }

  if (process.env.CODEPILOT_DEFAULT_API_KEY && !process.env.LUMOS_DEFAULT_API_KEY) {
    console.warn('[providers] CODEPILOT_DEFAULT_API_KEY is deprecated. Please use LUMOS_DEFAULT_API_KEY instead.');
  }

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  const transaction = db.transaction(() => {
    db.prepare(
      'UPDATE api_providers SET name = ?, provider_type = ?, base_url = ?, api_key = ?, extra_env = ?, model_catalog = ?, model_catalog_source = ?, model_catalog_updated_at = ?, notes = ?, user_modified = ?, updated_at = ? WHERE id = ?'
    ).run('Built-in', 'anthropic', defaultBaseUrl, defaultKey, '{}', '[]', 'default', null, 'Auto-created from embedded key', 0, now, builtin.id);

    if (builtin.is_active === 1) {
      setDefaultProviderSetting(db, builtin.id);
    }
  });

  transaction();

  return getProvider(builtin.id);
}
