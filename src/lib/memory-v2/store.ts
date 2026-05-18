import crypto from 'crypto';
import { getDb } from '@/lib/db/connection';
import type {
  MemoryV2Entry,
  MemoryV2Input,
  MemoryV2Kind,
  MemoryV2ListFilters,
  MemoryV2ScopeType,
  MemoryV2Sensitivity,
  MemoryV2Status,
  MemoryV2UpdateInput,
} from './types';

const KIND_SET = new Set<MemoryV2Kind>(['task', 'people', 'resource', 'capability', 'reflection']);
const SCOPE_SET = new Set<MemoryV2ScopeType>(['user', 'main_agent', 'project', 'session', 'module', 'entity']);
const STATUS_SET = new Set<MemoryV2Status>(['candidate', 'active', 'archived', 'rejected']);
const SENSITIVITY_SET = new Set<MemoryV2Sensitivity>(['normal', 'sensitive_ref', 'secret_ref_required']);

function nowSql(): string {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

function normalizeText(value: unknown, max = 4000): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function normalizeMultiline(value: unknown, max = 8000): string {
  const text = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function normalizeTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  const uniq = new Set<string>();
  for (const tag of tags) {
    const value = normalizeText(tag, 48).toLowerCase();
    if (!value) continue;
    uniq.add(value);
    if (uniq.size >= 24) break;
  }
  return Array.from(uniq);
}

function normalizeJson(value?: Record<string, unknown>): string {
  if (!value || typeof value !== 'object') return '{}';
  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

function normalizeImportance(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(5, Math.round(parsed)));
}

function normalizeConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0, Math.min(1, parsed));
}

function assertKind(value: string): MemoryV2Kind {
  if (KIND_SET.has(value as MemoryV2Kind)) return value as MemoryV2Kind;
  throw new Error(`invalid memory kind: ${value}`);
}

function assertScopeType(value: string): MemoryV2ScopeType {
  if (SCOPE_SET.has(value as MemoryV2ScopeType)) return value as MemoryV2ScopeType;
  throw new Error(`invalid memory scope type: ${value}`);
}

function assertStatus(value: string): MemoryV2Status {
  if (STATUS_SET.has(value as MemoryV2Status)) return value as MemoryV2Status;
  throw new Error(`invalid memory status: ${value}`);
}

function assertSensitivity(value: string): MemoryV2Sensitivity {
  if (SENSITIVITY_SET.has(value as MemoryV2Sensitivity)) return value as MemoryV2Sensitivity;
  throw new Error(`invalid memory sensitivity: ${value}`);
}

function normalizeScopeKey(scopeType: MemoryV2ScopeType, scopeKey?: string, fallback = ''): string {
  if (scopeType === 'user') return 'default';
  if (scopeType === 'main_agent') return 'main';
  return normalizeText(scopeKey || fallback, 520);
}

export function parseMemoryV2Tags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return normalizeTags(parsed.map((item) => String(item)));
  } catch {
    return [];
  }
}

export function listMemoryV2Entries(filters: MemoryV2ListFilters = {}): MemoryV2Entry[] {
  const db = getDb();
  const clauses: string[] = [];
  const args: unknown[] = [];

  if (filters.status && filters.status !== 'all') {
    clauses.push('status = ?');
    args.push(filters.status);
  } else if (!filters.includeArchived) {
    clauses.push("status != 'archived' AND status != 'rejected'");
  }

  if (filters.kind && filters.kind !== 'all') {
    clauses.push('kind = ?');
    args.push(filters.kind);
  }

  if (filters.scopeType && filters.scopeType !== 'all') {
    clauses.push('scope_type = ?');
    args.push(filters.scopeType);
  }

  if (filters.scopeKey?.trim()) {
    clauses.push('scope_key = ?');
    args.push(filters.scopeKey.trim());
  }

  if (filters.ownerModule?.trim()) {
    clauses.push('owner_module = ?');
    args.push(filters.ownerModule.trim());
  }

  if (filters.query?.trim()) {
    const q = `%${filters.query.trim()}%`;
    clauses.push('(title LIKE ? OR body LIKE ? OR summary LIKE ? OR tags LIKE ? OR evidence LIKE ?)');
    args.push(q, q, q, q, q);
  }

  const limit = Math.max(1, Math.min(filters.limit ?? 200, 1000));
  args.push(limit);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(
    `SELECT * FROM memory_v2_entries
     ${where}
     ORDER BY status = 'candidate' DESC, importance DESC, updated_at DESC
     LIMIT ?`,
  ).all(...args) as MemoryV2Entry[];
}

export function listMemoryV2ForScopes(params: {
  scopes: Array<{ type: MemoryV2ScopeType; key: string }>;
  limit?: number;
}): MemoryV2Entry[] {
  const scopes = params.scopes
    .map((scope) => ({
      type: assertScopeType(scope.type),
      key: normalizeScopeKey(scope.type, scope.key),
    }))
    .filter((scope) => scope.key);

  if (scopes.length === 0) return [];
  const db = getDb();
  const where = scopes.map(() => '(scope_type = ? AND scope_key = ?)').join(' OR ');
  const args = scopes.flatMap((scope) => [scope.type, scope.key]);
  const limit = Math.max(1, Math.min(params.limit ?? 80, 200));
  return db.prepare(
    `SELECT * FROM memory_v2_entries
     WHERE status = 'active'
       AND (${where})
     ORDER BY importance DESC, hit_count DESC, updated_at DESC
     LIMIT ?`,
  ).all(...args, limit) as MemoryV2Entry[];
}

export function getMemoryV2Entry(id: string): MemoryV2Entry | undefined {
  return getDb().prepare('SELECT * FROM memory_v2_entries WHERE id = ?').get(id) as MemoryV2Entry | undefined;
}

export function createMemoryV2Entry(input: MemoryV2Input): MemoryV2Entry {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const kind = assertKind(input.kind);
  const scopeType = assertScopeType(input.scopeType);
  const status = assertStatus(input.status || 'active');
  const sensitivity = assertSensitivity(input.sensitivity || 'normal');
  const projectPath = normalizeText(input.projectPath, 1024);
  const scopeKey = normalizeScopeKey(scopeType, input.scopeKey, projectPath || input.sessionId || input.relatedEntityId);
  const title = normalizeText(input.title, 180);
  const body = normalizeMultiline(input.body);
  if (!title) throw new Error('memory title is required');
  if (!body) throw new Error('memory body is required');

  const now = nowSql();
  db.prepare(
    `INSERT INTO memory_v2_entries
      (id, kind, scope_type, scope_key, owner_module, status, title, body, summary, tags,
       source_type, source_id, session_id, message_id, project_path, related_entity_type,
       related_entity_id, sensitivity, secret_ref, confidence, importance, evidence, metadata,
       created_at, updated_at, hit_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
  ).run(
    id,
    kind,
    scopeType,
    scopeKey,
    normalizeText(input.ownerModule, 120),
    status,
    title,
    body,
    normalizeMultiline(input.summary, 1200),
    JSON.stringify(normalizeTags(input.tags)),
    normalizeText(input.sourceType || 'manual', 80),
    normalizeText(input.sourceId, 240),
    normalizeText(input.sessionId, 80),
    normalizeText(input.messageId, 80),
    projectPath,
    normalizeText(input.relatedEntityType, 80),
    normalizeText(input.relatedEntityId, 160),
    sensitivity,
    normalizeText(input.secretRef, 240),
    normalizeConfidence(input.confidence),
    normalizeImportance(input.importance),
    normalizeMultiline(input.evidence, 2400),
    normalizeJson(input.metadata),
    now,
    now,
  );

  return getMemoryV2Entry(id)!;
}

export function updateMemoryV2Entry(id: string, input: MemoryV2UpdateInput): MemoryV2Entry | undefined {
  const existing = getMemoryV2Entry(id);
  if (!existing) return undefined;

  const kind = input.kind ? assertKind(input.kind) : existing.kind;
  const scopeType = input.scopeType ? assertScopeType(input.scopeType) : existing.scope_type;
  const status = input.status ? assertStatus(input.status) : existing.status;
  const sensitivity = input.sensitivity ? assertSensitivity(input.sensitivity) : existing.sensitivity;
  const projectPath = input.projectPath !== undefined ? normalizeText(input.projectPath, 1024) : existing.project_path;
  const scopeKey = input.scopeKey !== undefined || input.scopeType !== undefined || input.projectPath !== undefined
    ? normalizeScopeKey(scopeType, input.scopeKey ?? existing.scope_key, projectPath || existing.session_id || existing.related_entity_id)
    : existing.scope_key;
  const title = input.title !== undefined ? normalizeText(input.title, 180) : existing.title;
  const body = input.body !== undefined ? normalizeMultiline(input.body) : existing.body;
  if (!title || !body) throw new Error('memory title and body are required');

  getDb().prepare(
    `UPDATE memory_v2_entries
     SET kind = ?,
         scope_type = ?,
         scope_key = ?,
         owner_module = ?,
         status = ?,
         title = ?,
         body = ?,
         summary = ?,
         tags = ?,
         source_type = ?,
         source_id = ?,
         session_id = ?,
         message_id = ?,
         project_path = ?,
         related_entity_type = ?,
         related_entity_id = ?,
         sensitivity = ?,
         secret_ref = ?,
         confidence = ?,
         importance = ?,
         evidence = ?,
         metadata = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    kind,
    scopeType,
    scopeKey,
    input.ownerModule !== undefined ? normalizeText(input.ownerModule, 120) : existing.owner_module,
    status,
    title,
    body,
    input.summary !== undefined ? normalizeMultiline(input.summary, 1200) : existing.summary,
    input.tags !== undefined ? JSON.stringify(normalizeTags(input.tags)) : existing.tags,
    input.sourceType !== undefined ? normalizeText(input.sourceType, 80) : existing.source_type,
    input.sourceId !== undefined ? normalizeText(input.sourceId, 240) : existing.source_id,
    input.sessionId !== undefined ? normalizeText(input.sessionId, 80) : existing.session_id,
    input.messageId !== undefined ? normalizeText(input.messageId, 80) : existing.message_id,
    projectPath,
    input.relatedEntityType !== undefined ? normalizeText(input.relatedEntityType, 80) : existing.related_entity_type,
    input.relatedEntityId !== undefined ? normalizeText(input.relatedEntityId, 160) : existing.related_entity_id,
    sensitivity,
    input.secretRef !== undefined ? normalizeText(input.secretRef, 240) : existing.secret_ref,
    input.confidence !== undefined ? normalizeConfidence(input.confidence) : existing.confidence,
    input.importance !== undefined ? normalizeImportance(input.importance) : existing.importance,
    input.evidence !== undefined ? normalizeMultiline(input.evidence, 2400) : existing.evidence,
    input.metadata !== undefined ? normalizeJson(input.metadata) : existing.metadata,
    nowSql(),
    id,
  );

  return getMemoryV2Entry(id);
}

export function setMemoryV2Status(id: string, status: MemoryV2Status): boolean {
  assertStatus(status);
  const result = getDb().prepare(
    'UPDATE memory_v2_entries SET status = ?, updated_at = ? WHERE id = ?',
  ).run(status, nowSql(), id);
  return result.changes > 0;
}

export function deleteMemoryV2Entry(id: string): boolean {
  const result = getDb().prepare('DELETE FROM memory_v2_entries WHERE id = ?').run(id);
  return result.changes > 0;
}

// 语义召回向量。写入与内容解耦：创建/更新仍同步，向量由 extraction 写后即嵌入、
// 睡眠回填兜底（幂等：只填 embedding IS NULL 的）。
export function setMemoryV2Embedding(id: string, embedding: Buffer): boolean {
  const result = getDb().prepare(
    'UPDATE memory_v2_entries SET embedding = ? WHERE id = ?',
  ).run(embedding, id);
  return result.changes > 0;
}

export function listMemoryV2EntriesMissingEmbedding(limit = 200): MemoryV2Entry[] {
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  return getDb().prepare(
    `SELECT * FROM memory_v2_entries
     WHERE embedding IS NULL AND status IN ('active','candidate')
     ORDER BY updated_at DESC
     LIMIT ?`,
  ).all(safeLimit) as MemoryV2Entry[];
}

export function touchMemoryV2Usage(ids: string[], params: {
  sessionId?: string;
  scopeKey?: string;
  promptPreview?: string;
} = {}): void {
  const memoryIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (memoryIds.length === 0) return;
  const db = getDb();
  const now = nowSql();
  // 召回只更新使用痕迹，绝不刷 updated_at——否则"被注入=变新鲜"，
  // 排序里的新鲜度永不衰减、hit_count 滚雪球，噪声会自我置顶。
  const update = db.prepare(
    'UPDATE memory_v2_entries SET hit_count = hit_count + 1, last_used_at = ? WHERE id = ?',
  );
  const insert = db.prepare(
    `INSERT INTO memory_v2_usage_log (id, memory_id, session_id, scope_key, prompt_preview, used_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const run = db.transaction((idsToTouch: string[]) => {
    for (const id of idsToTouch) {
      update.run(now, id);
      insert.run(
        crypto.randomBytes(16).toString('hex'),
        id,
        normalizeText(params.sessionId, 80),
        normalizeText(params.scopeKey, 520),
        normalizeText(params.promptPreview, 240),
        now,
      );
    }
  });
  run(memoryIds);
}
