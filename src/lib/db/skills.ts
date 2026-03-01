import crypto from 'crypto';
import type { SkillDefinition } from '@/types';
import { getDb } from './connection';

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

  return getSkill(id)!;
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

  return getSkill(id);
}

export function deleteSkill(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM skills WHERE id = ?').run(id);
  return result.changes > 0;
}

export function toggleSkillEnabled(id: string, enabled: boolean): boolean {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const result = db.prepare('UPDATE skills SET is_enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, now, id);
  return result.changes > 0;
}

