import crypto from 'crypto';
import { getAppPlatformService } from '@/lib/app/service';
import { getDb } from '@/lib/db/connection';
import type { MemoryV2ScopeType } from './types';

export interface MemoryV2SecretInput {
  label: string;
  valueType?: string;
  value: string;
  scopeType?: MemoryV2ScopeType;
  scopeKey?: string;
  ownerModule?: string;
  sourceType?: string;
  sourceId?: string;
  sessionId?: string;
  messageId?: string;
  projectPath?: string;
  metadata?: Record<string, unknown>;
}

export interface MemoryV2SecretMeta {
  secret_ref: string;
  label: string;
  value_type: string;
  scope_type: string;
  scope_key: string;
  owner_module: string;
  source_type: string;
  source_id: string;
  session_id: string;
  message_id: string;
  project_path: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function nowSql(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

function normalizeText(value: unknown, max = 1000): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function normalizeJson(value?: Record<string, unknown>): string {
  if (!value || typeof value !== 'object') return '{}';
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function normalizeValueType(value?: string): string {
  const text = normalizeText(value || 'secret', 32).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  return text || 'secret';
}

function buildSecretRef(input: {
  label: string;
  valueType: string;
  scopeType?: string;
  scopeKey?: string;
  ownerModule?: string;
  sourceId?: string;
}): string {
  const basis = [
    input.valueType,
    normalizeText(input.label, 160).toLowerCase(),
    input.scopeType || '',
    input.scopeKey || '',
    input.ownerModule || '',
    input.sourceId || '',
  ].join('|');
  const digest = crypto.createHash('sha256').update(basis).digest('hex').slice(0, 24);
  return `secret://memory-v2/${digest}`;
}

export function storeMemoryV2Secret(input: MemoryV2SecretInput): string {
  const label = normalizeText(input.label, 160) || 'secret';
  const value = String(input.value ?? '');
  if (!value) throw new Error('secret value is required');

  const valueType = normalizeValueType(input.valueType);
  const scopeType = normalizeText(input.scopeType, 80);
  const scopeKey = normalizeText(input.scopeKey, 520);
  const ownerModule = normalizeText(input.ownerModule, 120);
  const sourceId = normalizeText(input.sourceId, 240);
  const secretRef = buildSecretRef({
    label,
    valueType,
    scopeType,
    scopeKey,
    ownerModule,
    sourceId,
  });
  const encrypted = getAppPlatformService().cryptor.encrypt(value);
  const now = nowSql();

  getDb().prepare(
    `INSERT INTO memory_v2_secret_values
      (secret_ref, label, value_type, value_encrypted, scope_type, scope_key,
       owner_module, source_type, source_id, session_id, message_id, project_path,
       metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(secret_ref) DO UPDATE SET
       label = excluded.label,
       value_type = excluded.value_type,
       value_encrypted = excluded.value_encrypted,
       scope_type = excluded.scope_type,
       scope_key = excluded.scope_key,
       owner_module = excluded.owner_module,
       source_type = excluded.source_type,
       source_id = excluded.source_id,
       session_id = excluded.session_id,
       message_id = excluded.message_id,
       project_path = excluded.project_path,
       metadata = excluded.metadata,
       updated_at = excluded.updated_at`,
  ).run(
    secretRef,
    label,
    valueType,
    encrypted,
    scopeType,
    scopeKey,
    ownerModule,
    normalizeText(input.sourceType, 80),
    sourceId,
    normalizeText(input.sessionId, 80),
    normalizeText(input.messageId, 80),
    normalizeText(input.projectPath, 1024),
    normalizeJson(input.metadata),
    now,
    now,
  );

  return secretRef;
}

export function getMemoryV2SecretValue(secretRef: string): string | null {
  const row = getDb()
    .prepare('SELECT value_encrypted FROM memory_v2_secret_values WHERE secret_ref = ?')
    .get(secretRef) as { value_encrypted: string } | undefined;
  if (!row) return null;
  return getAppPlatformService().cryptor.decrypt(row.value_encrypted);
}

export function getMemoryV2SecretMeta(secretRef: string): MemoryV2SecretMeta | undefined {
  return getDb()
    .prepare(
      `SELECT secret_ref, label, value_type, scope_type, scope_key, owner_module,
              source_type, source_id, session_id, message_id, project_path,
              metadata, created_at, updated_at
         FROM memory_v2_secret_values
        WHERE secret_ref = ?`,
    )
    .get(secretRef) as MemoryV2SecretMeta | undefined;
}
