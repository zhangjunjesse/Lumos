/**
 * Document store — CRUD for the Lumos documents table
 */
import { getDb } from '@/lib/db';
import { genId, now } from './helpers';

/** Count words: Chinese chars count as 1 word each, English words split by whitespace */
function countWords(text: string): number {
  if (!text) return 0;
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length || 0;
  const eng = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ')
    .split(/\s+/).filter(w => w.length > 0).length;
  return cjk + eng;
}

export interface Document {
  id: string;
  title: string;
  content: string;
  format: string;
  source_type: string;
  source_path: string;
  source_meta: string;
  kb_enabled: number;
  kb_item_id: string | null;
  kb_status: string;
  kb_error: string;
  status: string;
  parse_error: string;
  tags: string;
  word_count: number;
  created_at: string;
  updated_at: string;
}

export interface CreateDocumentInput {
  title?: string;
  content?: string;
  format?: string;
  source_type?: string;
  source_path?: string;
  source_meta?: Record<string, unknown>;
  tags?: string[];
}

export interface ListDocumentsOptions {
  q?: string;
  source_type?: string;
  kb_status?: string;
  status?: string;
  sort?: 'updated_at' | 'created_at' | 'title';
  order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export function createDocument(input: CreateDocumentInput = {}): Document {
  const db = getDb();
  const id = genId();
  const ts = now();
  const wordCount = countWords(input.content || '');

  db.prepare(`
    INSERT INTO documents (id, title, content, format, source_type, source_path, source_meta, tags, word_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.title || 'Untitled',
    input.content || '',
    input.format || 'markdown',
    input.source_type || 'create',
    input.source_path || '',
    JSON.stringify(input.source_meta || {}),
    JSON.stringify(input.tags || []),
    wordCount,
    ts, ts,
  );
  return getDocument(id)!;
}

export function getDocument(id: string): Document | undefined {
  return getDb().prepare('SELECT * FROM documents WHERE id = ?').get(id) as Document | undefined;
}

export function listDocuments(opts: ListDocumentsOptions = {}): { rows: Document[]; total: number } {
  const db = getDb();
  const wheres: string[] = [];
  const params: unknown[] = [];

  if (opts.q) {
    wheres.push('(title LIKE ? OR content LIKE ?)');
    params.push(`%${opts.q}%`, `%${opts.q}%`);
  }
  if (opts.source_type) { wheres.push('source_type = ?'); params.push(opts.source_type); }
  if (opts.kb_status) { wheres.push('kb_status = ?'); params.push(opts.kb_status); }
  if (opts.status) { wheres.push('status = ?'); params.push(opts.status); }

  const where = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
  const sort = opts.sort || 'updated_at';
  const order = opts.order || 'desc';
  const limit = opts.limit || 50;
  const offset = opts.offset || 0;

  const total = (db.prepare(`SELECT COUNT(*) as c FROM documents ${where}`).get(...params) as { c: number }).c;
  const rows = db.prepare(
    `SELECT * FROM documents ${where} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as Document[];

  return { rows, total };
}

export function updateDocument(id: string, updates: Partial<{
  title: string; content: string; format: string;
  kb_enabled: number; kb_status: string; kb_error: string; kb_item_id: string | null;
  status: string; parse_error: string; tags: string[]; source_meta: Record<string, unknown>;
}>): Document | undefined {
  const db = getDb();
  const ts = now();
  const sets: string[] = ['updated_at = ?'];
  const vals: unknown[] = [ts];

  if (updates.title !== undefined) { sets.push('title = ?'); vals.push(updates.title); }
  if (updates.content !== undefined) {
    sets.push('content = ?', 'word_count = ?');
    vals.push(updates.content, countWords(updates.content));
  }
  if (updates.format !== undefined) { sets.push('format = ?'); vals.push(updates.format); }
  if (updates.kb_enabled !== undefined) { sets.push('kb_enabled = ?'); vals.push(updates.kb_enabled); }
  if (updates.kb_status !== undefined) { sets.push('kb_status = ?'); vals.push(updates.kb_status); }
  if (updates.kb_error !== undefined) { sets.push('kb_error = ?'); vals.push(updates.kb_error); }
  if (updates.kb_item_id !== undefined) { sets.push('kb_item_id = ?'); vals.push(updates.kb_item_id); }
  if (updates.status !== undefined) { sets.push('status = ?'); vals.push(updates.status); }
  if (updates.parse_error !== undefined) { sets.push('parse_error = ?'); vals.push(updates.parse_error); }
  if (updates.tags !== undefined) { sets.push('tags = ?'); vals.push(JSON.stringify(updates.tags)); }
  if (updates.source_meta !== undefined) { sets.push('source_meta = ?'); vals.push(JSON.stringify(updates.source_meta)); }

  vals.push(id);
  db.prepare(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getDocument(id);
}

export function deleteDocument(id: string): boolean {
  return getDb().prepare('DELETE FROM documents WHERE id = ?').run(id).changes > 0;
}
