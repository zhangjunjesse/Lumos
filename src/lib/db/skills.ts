import crypto from 'crypto';
import { getDb } from './connection';
import { recordMemoryV2CapabilityEvent } from '@/lib/memory-v2/capability-events';

// ==========================================
// Skill Database Types
// ==========================================

export interface SkillRecord {
  id: string;
  name: string;
  scope: 'builtin' | 'user';
  description: string;
  file_path: string;
  content_hash: string;
  is_enabled: number;
  created_at: string;
  updated_at: string;
}

export interface CreateSkillData {
  name: string;
  scope: 'builtin' | 'user';
  description: string;
  file_path: string;
  content_hash: string;
  is_enabled?: boolean;
}

export interface UpdateSkillData {
  description?: string;
  file_path?: string;
  content_hash?: string;
  is_enabled?: boolean;
}

// ==========================================
// Skill Operations
// ==========================================

export function getAllSkills(): SkillRecord[] {
  const db = getDb();
  return db.prepare('SELECT * FROM skills ORDER BY scope ASC, name ASC').all() as SkillRecord[];
}

export function getSkillsByScope(scope: 'builtin' | 'user'): SkillRecord[] {
  const db = getDb();
  return db.prepare('SELECT * FROM skills WHERE scope = ? ORDER BY name ASC').all(scope) as SkillRecord[];
}

export function getEnabledSkills(): SkillRecord[] {
  const db = getDb();
  return db.prepare('SELECT * FROM skills WHERE is_enabled = 1 ORDER BY scope ASC, name ASC').all() as SkillRecord[];
}

export function getSkill(id: string): SkillRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRecord | undefined;
}

export function getSkillByNameAndScope(name: string, scope: 'builtin' | 'user'): SkillRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM skills WHERE name = ? AND scope = ?').get(name, scope) as SkillRecord | undefined;
}

export function createSkill(data: CreateSkillData): SkillRecord {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  db.prepare(
    'INSERT INTO skills (id, name, scope, description, file_path, content_hash, is_enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    data.name,
    data.scope,
    data.description,
    data.file_path,
    data.content_hash,
    data.is_enabled ? 1 : 0,
    now,
    now,
  );

  const record = getSkill(id)!;
  recordMemoryV2CapabilityEvent({
    capabilityType: 'skill',
    capabilityName: record.name,
    scope: record.scope,
    action: 'created',
    status: 'success',
    source: record.scope === 'builtin' ? 'builtin-resource-sync' : 'skill-manager',
    summary: record.description,
    relatedId: record.id,
    version: record.content_hash,
    metadata: {
      enabled: record.is_enabled === 1,
      contentHash: record.content_hash,
    },
  });
  return record;
}

export function updateSkill(id: string, data: UpdateSkillData): SkillRecord | undefined {
  const db = getDb();
  const existing = getSkill(id);
  if (!existing) return undefined;

  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const description = data.description ?? existing.description;
  const filePath = data.file_path ?? existing.file_path;
  const contentHash = data.content_hash ?? existing.content_hash;
  const isEnabled = data.is_enabled !== undefined ? (data.is_enabled ? 1 : 0) : existing.is_enabled;

  db.prepare(
    'UPDATE skills SET description = ?, file_path = ?, content_hash = ?, is_enabled = ?, updated_at = ? WHERE id = ?'
  ).run(description, filePath, contentHash, isEnabled, now, id);

  const updated = getSkill(id);
  if (updated) {
    const changed = existing.content_hash !== updated.content_hash || existing.description !== updated.description;
    recordMemoryV2CapabilityEvent({
      capabilityType: 'skill',
      capabilityName: updated.name,
      scope: updated.scope,
      action: changed ? 'updated' : (updated.is_enabled === 1 ? 'enabled' : 'disabled'),
      status: 'success',
      source: updated.scope === 'builtin' ? 'builtin-resource-sync' : 'skill-manager',
      summary: updated.description,
      relatedId: updated.id,
      version: updated.content_hash,
      metadata: {
        enabled: updated.is_enabled === 1,
        contentHashChanged: existing.content_hash !== updated.content_hash,
      },
    });
  }
  return updated;
}

export function deleteSkill(id: string): boolean {
  const db = getDb();
  const existing = getSkill(id);
  const result = db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  if (result.changes > 0 && existing) {
    recordMemoryV2CapabilityEvent({
      capabilityType: 'skill',
      capabilityName: existing.name,
      scope: existing.scope,
      action: 'deleted',
      status: 'success',
      source: existing.scope === 'builtin' ? 'builtin-resource-sync' : 'skill-manager',
      summary: existing.description,
      relatedId: existing.id,
      version: existing.content_hash,
    });
  }
  return result.changes > 0;
}

export function toggleSkillEnabled(id: string, enabled: boolean): boolean {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const result = db.prepare('UPDATE skills SET is_enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, now, id);
  if (result.changes > 0) {
    const updated = getSkill(id);
    if (updated) {
      recordMemoryV2CapabilityEvent({
        capabilityType: 'skill',
        capabilityName: updated.name,
        scope: updated.scope,
        action: enabled ? 'enabled' : 'disabled',
        status: 'success',
        source: 'skill-manager',
        summary: updated.description,
        relatedId: updated.id,
        version: updated.content_hash,
      });
    }
  }
  return result.changes > 0;
}
