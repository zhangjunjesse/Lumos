/**
 * Conversation store — CRUD for conversations + conversation_messages
 */
import { getDb } from '@/lib/db';
import { genId, now } from './helpers';

export interface Conversation {
  id: string;
  title: string;
  summary: string;
  message_count: number;
  source: string;
  source_doc_id: string | null;
  is_pinned: number;
  is_starred: number;
  tags: string;
  workspace_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  references: string;
  cited_doc_ids: string;
  token_count: number;
  created_at: string;
}

export interface CreateConversationInput {
  title?: string;
  source?: string;
  source_doc_id?: string;
  workspace_id?: string;
  tags?: string[];
}

export interface ListConversationsOptions {
  source?: string;
  is_starred?: boolean;
  is_pinned?: boolean;
  workspace_id?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

// ---- Conversations ----

export function createConversation(input: CreateConversationInput = {}): Conversation {
  const db = getDb();
  const id = genId();
  const ts = now();
  db.prepare(`
    INSERT INTO conversations (id, title, source, source_doc_id, workspace_id, tags, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.title || '', input.source || 'manual', input.source_doc_id || null, input.workspace_id || null, JSON.stringify(input.tags || []), ts, ts);
  return getConversation(id)!;
}

export function getConversation(id: string): Conversation | undefined {
  return getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as Conversation | undefined;
}

export function listConversations(opts: ListConversationsOptions = {}): { rows: Conversation[]; total: number } {
  const db = getDb();
  const wheres: string[] = [];
  const params: unknown[] = [];

  if (opts.source) { wheres.push('source = ?'); params.push(opts.source); }
  if (opts.is_starred) { wheres.push('is_starred = 1'); }
  if (opts.is_pinned) { wheres.push('is_pinned = 1'); }
  if (opts.workspace_id) { wheres.push('workspace_id = ?'); params.push(opts.workspace_id); }
  if (opts.q) {
    wheres.push('(title LIKE ? OR summary LIKE ?)');
    params.push(`%${opts.q}%`, `%${opts.q}%`);
  }

  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const limit = opts.limit || 50;
  const offset = opts.offset || 0;

  const total = (db.prepare(`SELECT COUNT(*) as c FROM conversations ${where}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM conversations ${where} ORDER BY is_pinned DESC, updated_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as Conversation[];

  return { rows, total };
}

export function updateConversation(id: string, updates: Partial<{
  title: string; summary: string; is_pinned: number; is_starred: number;
  tags: string[]; workspace_id: string | null;
}>): Conversation | undefined {
  const db = getDb();
  const ts = now();
  const sets: string[] = ['updated_at = ?'];
  const vals: unknown[] = [ts];

  if (updates.title !== undefined) { sets.push('title = ?'); vals.push(updates.title); }
  if (updates.summary !== undefined) { sets.push('summary = ?'); vals.push(updates.summary); }
  if (updates.is_pinned !== undefined) { sets.push('is_pinned = ?'); vals.push(updates.is_pinned); }
  if (updates.is_starred !== undefined) { sets.push('is_starred = ?'); vals.push(updates.is_starred); }
  if (updates.tags !== undefined) { sets.push('tags = ?'); vals.push(JSON.stringify(updates.tags)); }
  if (updates.workspace_id !== undefined) { sets.push('workspace_id = ?'); vals.push(updates.workspace_id); }

  vals.push(id);
  db.prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getConversation(id);
}

export function deleteConversation(id: string): boolean {
  const db = getDb();
  db.prepare('DELETE FROM conversation_messages WHERE conversation_id = ?').run(id);
  return db.prepare('DELETE FROM conversations WHERE id = ?').run(id).changes > 0;
}

// ---- Messages ----

export function addMessage(conversationId: string, input: {
  role: string; content: string;
  references?: string[]; cited_doc_ids?: string[];
  token_count?: number;
}): ConversationMessage {
  const db = getDb();
  const id = genId();
  const ts = now();

  db.prepare(`
    INSERT INTO conversation_messages (id, conversation_id, role, content, "references", cited_doc_ids, token_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, conversationId, input.role, input.content,
    JSON.stringify(input.references || []),
    JSON.stringify(input.cited_doc_ids || []),
    input.token_count || 0, ts,
  );

  // Update conversation counters; only overwrite summary on assistant replies
  if (input.role === 'assistant') {
    db.prepare(`
      UPDATE conversations SET message_count = message_count + 1, summary = ?, updated_at = ? WHERE id = ?
    `).run(input.content.slice(0, 200), ts, conversationId);
  } else {
    db.prepare(`
      UPDATE conversations SET message_count = message_count + 1, updated_at = ? WHERE id = ?
    `).run(ts, conversationId);
  }

  return getMessage(id)!;
}

export function getMessage(id: string): ConversationMessage | undefined {
  return getDb().prepare('SELECT * FROM conversation_messages WHERE id = ?').get(id) as ConversationMessage | undefined;
}

export function listMessages(conversationId: string, opts?: {
  limit?: number; offset?: number;
}): ConversationMessage[] {
  const limit = opts?.limit || 100;
  const offset = opts?.offset || 0;
  return getDb().prepare(
    'SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?'
  ).all(conversationId, limit, offset) as ConversationMessage[];
}

export function deleteMessage(id: string): boolean {
  const db = getDb();
  const msg = getMessage(id);
  if (!msg) return false;
  const result = db.prepare('DELETE FROM conversation_messages WHERE id = ?').run(id);
  if (result.changes > 0) {
    db.prepare('UPDATE conversations SET message_count = MAX(0, message_count - 1), updated_at = ? WHERE id = ?')
      .run(now(), msg.conversation_id);
  }
  return result.changes > 0;
}
