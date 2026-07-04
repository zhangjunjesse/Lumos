import crypto from 'crypto';
import path from 'path';
import type { ChatKnowledgeOptions, ChatSession, KnowledgeOverrides, Message, SettingsMap } from '@/types';
import type { SessionKind } from '@/lib/chat/session-kind';
import { getDb } from './connection';
import { taskEventBus } from '@/lib/task-event-bus';

// ==========================================
// Session Operations
// ==========================================

export function getAllSessions(): ChatSession[] {
  const db = getDb();
  return db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC').all() as ChatSession[];
}

export function getSession(id: string): ChatSession | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(id) as ChatSession | undefined;
}

export function createSession(
  title?: string,
  model?: string,
  systemPrompt?: string,
  workingDirectory?: string,
  mode?: string,
  folder?: string,
  providerId?: string,
  kind: SessionKind = 'chat',
): ChatSession {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const wd = workingDirectory || '';
  const projectName = path.basename(wd);
  const normalizedProviderId = providerId?.trim() || '';
  const providerName = normalizedProviderId
    ? ((db.prepare('SELECT name FROM api_providers WHERE id = ?').get(normalizedProviderId) as { name?: string } | undefined)?.name || '')
    : '';

  db.prepare(
    'INSERT INTO chat_sessions (id, kind, title, created_at, updated_at, model, requested_model, resolved_model, system_prompt, working_directory, sdk_session_id, project_name, status, mode, provider_name, provider_id, sdk_cwd, folder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    kind,
    title || 'New Chat',
    now,
    now,
    model || '',
    model || '',
    '',
    systemPrompt || '',
    wd,
    '',
    projectName,
    'active',
    mode || 'code',
    providerName,
    normalizedProviderId,
    wd,
    folder || '',
  );

  return getSession(id)!;
}

export function deleteSession(id: string): boolean {
  const db = getDb();
  const now = Date.now();
  db.prepare(
    `UPDATE session_bindings
       SET status = 'deleted', updated_at = ?
     WHERE lumos_session_id = ? AND status != 'deleted'`
  ).run(now, id);
  const result = db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
  return result.changes > 0;
}

export function updateSessionTimestamp(id: string): void {
  const db = getDb();
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(now, id);
}

export function updateSessionTitle(id: string, title: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET title = ? WHERE id = ?').run(title, id);
}

export function updateSdkSessionId(id: string, sdkSessionId: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET sdk_session_id = ? WHERE id = ?').run(sdkSessionId, id);
}

export function updateSessionModel(id: string, model: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET model = ?, requested_model = ? WHERE id = ?').run(model, model, id);
}

export function updateSessionResolvedModel(id: string, model: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET resolved_model = ? WHERE id = ?').run(model, id);
}

export function updateSessionProvider(id: string, providerName: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET provider_name = ? WHERE id = ?').run(providerName, id);
}

export function updateSessionProviderId(id: string, providerId: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET provider_id = ? WHERE id = ?').run(providerId, id);
}

export function updateSessionBrowserContext(id: string, browserContextId: string): void {
  const db = getDb();
  const normalized = browserContextId.trim() || 'embedded:default';
  db.prepare('UPDATE chat_sessions SET browser_context_id = ? WHERE id = ?').run(normalized, id);
}

function normalizeKnowledgeTagIds(tagIds: string[] | undefined): string[] {
  if (!Array.isArray(tagIds)) return [];
  return Array.from(new Set(tagIds.map((tagId) => String(tagId).trim()).filter(Boolean)));
}

function normalizeKnowledgeOverrides(overrides: KnowledgeOverrides | undefined): KnowledgeOverrides {
  const out: KnowledgeOverrides = {};
  if (!overrides || typeof overrides !== 'object') return out;
  if (overrides.retrievalMode === 'reference' || overrides.retrievalMode === 'enhanced') {
    out.retrievalMode = overrides.retrievalMode;
  }
  if (typeof overrides.rewriteEnabled === 'boolean') {
    out.rewriteEnabled = overrides.rewriteEnabled;
  }
  if (typeof overrides.topK === 'number' && Number.isFinite(overrides.topK) && overrides.topK > 0) {
    out.topK = Math.max(1, Math.min(10, Math.floor(overrides.topK)));
  }
  if (typeof overrides.candidatePool === 'number' && Number.isFinite(overrides.candidatePool) && overrides.candidatePool > 0) {
    out.candidatePool = Math.max(16, Math.min(120, Math.floor(overrides.candidatePool)));
  }
  return out;
}

export function updateSessionKnowledgeOptions(id: string, options: ChatKnowledgeOptions): void {
  const db = getDb();
  db.prepare(
    'UPDATE chat_sessions SET knowledge_enabled = ?, knowledge_tag_ids = ?, knowledge_overrides = ? WHERE id = ?',
  ).run(
    options.enabled ? 1 : 0,
    JSON.stringify(normalizeKnowledgeTagIds(options.tagIds)),
    JSON.stringify(normalizeKnowledgeOverrides(options.overrides)),
    id,
  );
}

export function updateSessionSystemPrompt(id: string, systemPrompt: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET system_prompt = ? WHERE id = ?').run(systemPrompt, id);
}

export function getDefaultProviderId(): string | undefined {
  return getSetting('default_provider_id') || undefined;
}

export function setDefaultProviderId(id: string): void {
  setSetting('default_provider_id', id);
}

export function updateSessionWorkingDirectory(id: string, workingDirectory: string): void {
  const db = getDb();
  const projectName = path.basename(workingDirectory);
  db.prepare('UPDATE chat_sessions SET working_directory = ?, project_name = ? WHERE id = ?').run(workingDirectory, projectName, id);
}

export function updateSessionMode(id: string, mode: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET mode = ? WHERE id = ?').run(mode, id);
}

// ==========================================
// Message Operations
// ==========================================

export function getMessages(
  sessionId: string,
  options?: { limit?: number; beforeRowId?: number },
): { messages: Message[]; hasMore: boolean } {
  const db = getDb();
  const limit = options?.limit ?? 100;
  const beforeRowId = options?.beforeRowId;

  let rows: Message[];
  if (beforeRowId) {
    rows = db.prepare(
      'SELECT *, rowid as _rowid FROM messages WHERE session_id = ? AND rowid < ? ORDER BY rowid DESC LIMIT ?'
    ).all(sessionId, beforeRowId, limit + 1) as Message[];
  } else {
    rows = db.prepare(
      'SELECT *, rowid as _rowid FROM messages WHERE session_id = ? ORDER BY rowid DESC LIMIT ?'
    ).all(sessionId, limit + 1) as Message[];
  }

  const hasMore = rows.length > limit;
  if (hasMore) {
    rows = rows.slice(0, limit);
  }

  rows.reverse();
  return { messages: rows, hasMore };
}

export function addMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  tokenUsage?: string | null,
  elapsedMs?: number | null,
): Message {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  db.prepare(
    'INSERT INTO messages (id, session_id, role, content, created_at, token_usage, elapsed_ms) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, sessionId, role, content, now, tokenUsage || null, elapsedMs ?? null);

  updateSessionTimestamp(sessionId);

  // Notify any open ChatView for this session so 入站 IM 消息（飞书/微信）和后台
  // 写入的 assistant 回复都能即时同步到 UI。ChatView 在 streaming 时通过 temp-id
  // 和 `enabled: !isStreaming` 双短路避免重复刷新。
  taskEventBus.emitTaskEvent({
    type: 'task:updated',
    sessionId,
    taskId: '',
    timestamp: Date.now(),
    data: { reason: 'message-added', role },
  });

  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Message;
}

export function updateMessageContent(messageId: string, content: string): number {
  const db = getDb();
  const result = db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, messageId);
  return result.changes;
}

/**
 * Find the most recent assistant message in a session that contains a given text snippet,
 * update its content, and return the real message ID.
 */
export function updateMessageBySessionAndHint(
  sessionId: string,
  promptHint: string,
  content: string,
): { changes: number; messageId?: string } {
  const db = getDb();
  const row = db.prepare(
    "SELECT id FROM messages WHERE session_id = ? AND role = 'assistant' AND content LIKE '%image-gen-request%' AND content LIKE ? ORDER BY created_at DESC LIMIT 1"
  ).get(sessionId, `%${promptHint.slice(0, 60)}%`) as { id: string } | undefined;

  if (!row) return { changes: 0 };

  const result = db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, row.id);
  return { changes: result.changes, messageId: row.id };
}

export function clearSessionMessages(sessionId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
  db.prepare('UPDATE chat_sessions SET sdk_session_id = ? WHERE id = ?').run('', sessionId);
}

// ==========================================
// Settings Operations
// ==========================================

export function getSetting(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

export function getAllSettings(): SettingsMap {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const settings: SettingsMap = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

// ==========================================
// Session Status Operations
// ==========================================

export function updateSessionStatus(id: string, status: 'active' | 'archived'): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET status = ? WHERE id = ?').run(status, id);
}
