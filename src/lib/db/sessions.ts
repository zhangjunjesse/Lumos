import crypto from 'crypto';
import path from 'path';
import type { ChatSession, Message, SettingsMap } from '@/types';
import { getDb } from './connection';

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
): ChatSession {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  const wd = workingDirectory || '';
  const projectName = path.basename(wd);

  db.prepare(
    'INSERT INTO chat_sessions (id, title, created_at, updated_at, model, system_prompt, working_directory, sdk_session_id, project_name, status, mode, sdk_cwd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, title || 'New Chat', now, now, model || '', systemPrompt || '', wd, '', projectName, 'active', mode || 'code', wd);

  return getSession(id)!;
}

export function deleteSession(id: string): boolean {
  const db = getDb();
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
  db.prepare('UPDATE chat_sessions SET model = ? WHERE id = ?').run(model, id);
}

export function updateSessionProvider(id: string, providerName: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET provider_name = ? WHERE id = ?').run(providerName, id);
}

export function updateSessionProviderId(id: string, providerId: string): void {
  const db = getDb();
  db.prepare('UPDATE chat_sessions SET provider_id = ? WHERE id = ?').run(providerId, id);
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
): Message {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];

  db.prepare(
    'INSERT INTO messages (id, session_id, role, content, created_at, token_usage) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, sessionId, role, content, now, tokenUsage || null);

  updateSessionTimestamp(sessionId);

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
