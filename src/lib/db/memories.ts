import crypto from 'crypto';
import { getDb } from './connection';

export type MemoryScope = 'global' | 'project' | 'session';
export type MemoryCategory = 'preference' | 'constraint' | 'fact' | 'workflow' | 'other';

export interface MemoryRecord {
  id: string;
  session_id: string;
  project_path: string;
  scope: MemoryScope;
  category: MemoryCategory;
  content: string;
  evidence: string;
  tags: string; // JSON array
  source: string;
  confidence: number;
  is_pinned: number;
  is_archived: number;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  hit_count: number;
}

export interface UpsertMemoryData {
  sessionId?: string;
  projectPath?: string;
  scope: MemoryScope;
  category: MemoryCategory;
  content: string;
  evidence?: string;
  tags?: string[];
  source?: string;
  confidence?: number;
  isPinned?: boolean;
}

export interface UpdateMemoryData {
  content?: string;
  scope?: MemoryScope;
  category?: MemoryCategory;
  tags?: string[];
  projectPath?: string;
}

export interface UpdateMemoryResult {
  exists: boolean;
  changed: boolean;
  error?: string;
}

function nowSql(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  const uniq = new Set<string>();
  for (const tag of tags) {
    const value = tag.trim();
    if (!value) continue;
    uniq.add(value);
    if (uniq.size >= 20) break;
  }
  return Array.from(uniq);
}

function normalizeContent(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function normalizeScope(scope: string): MemoryScope | null {
  if (scope === 'global' || scope === 'project' || scope === 'session') return scope;
  return null;
}

function normalizeCategory(category: string): MemoryCategory | null {
  if (category === 'preference' || category === 'constraint' || category === 'fact' || category === 'workflow' || category === 'other') {
    return category;
  }
  return null;
}

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function updateMemory(id: string, data: UpdateMemoryData): UpdateMemoryResult {
  const db = getDb();
  const existing = getMemory(id);
  if (!existing) return { exists: false, changed: false };

  const nextContent = data.content !== undefined
    ? normalizeContent(String(data.content || ''))
    : existing.content;
  if (!nextContent) {
    return { exists: true, changed: false, error: 'content is required' };
  }

  const nextScope = data.scope !== undefined
    ? normalizeScope(data.scope)
    : existing.scope;
  if (!nextScope) {
    return { exists: true, changed: false, error: 'invalid scope' };
  }

  const nextCategory = data.category !== undefined
    ? normalizeCategory(data.category)
    : existing.category;
  if (!nextCategory) {
    return { exists: true, changed: false, error: 'invalid category' };
  }

  const nextTags = data.tags !== undefined
    ? normalizeTags(data.tags)
    : (() => {
        try {
          const parsed = JSON.parse(existing.tags);
          return Array.isArray(parsed) ? normalizeTags(parsed.map((item) => String(item))) : [];
        } catch {
          return [];
        }
      })();

  let nextProjectPath = data.projectPath !== undefined
    ? String(data.projectPath || '').trim()
    : (existing.project_path || '').trim();

  if (nextScope === 'global') {
    nextProjectPath = '';
  }

  if (nextScope === 'project' && !nextProjectPath) {
    return { exists: true, changed: false, error: 'project_path is required for project scope' };
  }

  const oldTags = (() => {
    try {
      const parsed = JSON.parse(existing.tags);
      return Array.isArray(parsed) ? normalizeTags(parsed.map((item) => String(item))) : [];
    } catch {
      return [];
    }
  })();

  const unchanged =
    existing.content === nextContent
    && existing.scope === nextScope
    && existing.category === nextCategory
    && (existing.project_path || '') === nextProjectPath
    && sameTags(oldTags, nextTags);

  if (unchanged) {
    return { exists: true, changed: false };
  }

  const now = nowSql();
  const result = db.prepare(
    `UPDATE memories
     SET content = ?,
         scope = ?,
         category = ?,
         tags = ?,
         project_path = ?,
         updated_at = ?
     WHERE id = ?`
  ).run(
    nextContent,
    nextScope,
    nextCategory,
    JSON.stringify(nextTags),
    nextProjectPath,
    now,
    id,
  );

  return {
    exists: true,
    changed: result.changes > 0,
  };
}

export function getMemory(id: string): MemoryRecord | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRecord | undefined;
}

export function listMemoriesForContext(params: {
  projectPath?: string;
  sessionId?: string;
  limit?: number;
}): MemoryRecord[] {
  const db = getDb();
  const projectPath = (params.projectPath || '').trim();
  const sessionId = (params.sessionId || '').trim();
  const limit = Math.max(1, Math.min(params.limit ?? 80, 200));

  return db.prepare(
    `SELECT * FROM memories
     WHERE is_archived = 0
       AND (
         scope = 'global'
         OR (scope = 'project' AND project_path = ?)
         OR (scope = 'session' AND session_id = ?)
       )
     ORDER BY is_pinned DESC, updated_at DESC
     LIMIT ?`
  ).all(projectPath, sessionId, limit) as MemoryRecord[];
}

export function listRecentMemories(
  limit = 100,
  options?: { includeArchived?: boolean },
): MemoryRecord[] {
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(limit, 500));
  if (options?.includeArchived) {
    return db.prepare(
      `SELECT * FROM memories
       ORDER BY updated_at DESC
       LIMIT ?`
    ).all(safeLimit) as MemoryRecord[];
  }
  return db.prepare(
    `SELECT * FROM memories
     WHERE is_archived = 0
     ORDER BY updated_at DESC
     LIMIT ?`
  ).all(safeLimit) as MemoryRecord[];
}

export function upsertMemory(data: UpsertMemoryData): MemoryRecord {
  const db = getDb();
  const normalizedContent = normalizeContent(data.content);
  const scope = data.scope;
  const projectPath = (data.projectPath || '').trim();
  const sessionId = (data.sessionId || '').trim();
  const evidence = (data.evidence || '').trim();
  const source = (data.source || 'user_explicit').trim() || 'user_explicit';
  const category = data.category;
  const confidence = Math.max(0, Math.min(data.confidence ?? 1, 1));
  const tags = normalizeTags(data.tags);

  const existing = db.prepare(
    `SELECT id FROM memories
     WHERE is_archived = 0
       AND scope = ?
       AND project_path = ?
       AND session_id = ?
       AND content = ?
     LIMIT 1`
  ).get(scope, projectPath, sessionId, normalizedContent) as { id: string } | undefined;

  const now = nowSql();
  if (existing) {
    db.prepare(
      `UPDATE memories
       SET category = ?,
           evidence = ?,
           tags = ?,
           source = ?,
           confidence = ?,
           is_pinned = ?,
           updated_at = ?
       WHERE id = ?`
    ).run(
      category,
      evidence,
      JSON.stringify(tags),
      source,
      confidence,
      data.isPinned ? 1 : 0,
      now,
      existing.id,
    );
    return getMemory(existing.id)!;
  }

  const id = crypto.randomBytes(16).toString('hex');
  db.prepare(
    `INSERT INTO memories
      (id, session_id, project_path, scope, category, content, evidence, tags, source, confidence, is_pinned, is_archived, created_at, updated_at, hit_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0)`
  ).run(
    id,
    sessionId,
    projectPath,
    scope,
    category,
    normalizedContent,
    evidence,
    JSON.stringify(tags),
    source,
    confidence,
    data.isPinned ? 1 : 0,
    now,
    now,
  );

  return getMemory(id)!;
}

export function touchMemoriesUsage(ids: string[]): void {
  if (ids.length === 0) return;

  const db = getDb();
  const now = nowSql();
  const stmt = db.prepare(
    'UPDATE memories SET hit_count = hit_count + 1, last_used_at = ?, updated_at = ? WHERE id = ?'
  );

  const run = db.transaction((memoryIds: string[]) => {
    for (const id of memoryIds) {
      stmt.run(now, now, id);
    }
  });

  run(ids);
}

export function archiveMemory(id: string): boolean {
  return setMemoryArchived(id, true);
}

export function setMemoryPinned(id: string, pinned: boolean): boolean {
  const db = getDb();
  const now = nowSql();
  const result = db.prepare(
    'UPDATE memories SET is_pinned = ?, updated_at = ? WHERE id = ?'
  ).run(pinned ? 1 : 0, now, id);
  return result.changes > 0;
}

export function setMemoryArchived(id: string, archived: boolean): boolean {
  const db = getDb();
  const now = nowSql();
  const result = db.prepare(
    'UPDATE memories SET is_archived = ?, updated_at = ? WHERE id = ?'
  ).run(archived ? 1 : 0, now, id);
  return result.changes > 0;
}

export function updateMemoryContent(id: string, content: string): boolean {
  const result = updateMemory(id, { content });
  return result.exists && (result.changed || !result.error);
}

export function deleteMemory(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
  return result.changes > 0;
}
