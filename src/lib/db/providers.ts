import crypto from 'crypto';
import type { ApiProvider, CreateProviderRequest, UpdateProviderRequest } from '@/types';
import { getDb } from './connection';

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

  db.prepare(
    'INSERT INTO api_providers (id, name, provider_type, base_url, api_key, is_active, sort_order, extra_env, notes, is_builtin, user_modified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.name,
    data.provider_type || 'anthropic',
    data.base_url || '',
    data.api_key || '',
    0,
    sortOrder,
    data.extra_env || '{}',
    data.notes || '',
    0,
    0,
    now,
    now,
  );

  return getProvider(id)!;
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
  const notes = data.notes ?? existing.notes;
  const sortOrder = data.sort_order ?? existing.sort_order;

  // If this is a builtin provider, mark it as user_modified
  const userModified = existing.is_builtin ? 1 : existing.user_modified;

  db.prepare(
    'UPDATE api_providers SET name = ?, provider_type = ?, base_url = ?, api_key = ?, extra_env = ?, notes = ?, sort_order = ?, user_modified = ?, updated_at = ? WHERE id = ?'
  ).run(name, providerType, baseUrl, apiKey, extraEnv, notes, sortOrder, userModified, now, id);

  return getProvider(id);
}

export function deleteProvider(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM api_providers WHERE id = ?').run(id);
  return result.changes > 0;
}

export function activateProvider(id: string): boolean {
  const db = getDb();
  const existing = getProvider(id);
  if (!existing) return false;

  const transaction = db.transaction(() => {
    db.prepare('UPDATE api_providers SET is_active = 0').run();
    db.prepare('UPDATE api_providers SET is_active = 1 WHERE id = ?').run(id);
  });
  transaction();
  return true;
}

export function deactivateAllProviders(): void {
  const db = getDb();
  db.prepare('UPDATE api_providers SET is_active = 0').run();
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

  db.prepare(
    'UPDATE api_providers SET name = ?, provider_type = ?, base_url = ?, api_key = ?, extra_env = ?, notes = ?, user_modified = ?, updated_at = ? WHERE id = ?'
  ).run('Built-in', 'anthropic', defaultBaseUrl, defaultKey, '{}', 'Auto-created from embedded key', 0, now, builtin.id);

  return getProvider(builtin.id);
}
