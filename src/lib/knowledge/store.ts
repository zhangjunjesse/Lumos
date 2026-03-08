/**
 * Knowledge store — SQLite CRUD for collections, items, chunks
 * Replaces demo's JSON-file-based store
 */
import { getDb } from '@/lib/db';
import { genId, now } from '@/lib/stores/helpers';
import type { KbCollection, KbItem, KbChunk, KbProcessingStatus } from './types';
import { removeItemFromTagSystem } from './tag-system';

let kbItemRuntimeSchemaChecked = false;

const KB_ITEM_RUNTIME_COLUMNS: Array<[string, string]> = [
  ['source_key', "TEXT NOT NULL DEFAULT ''"],
  ['chunk_count', "INTEGER NOT NULL DEFAULT 0"],
  ['processing_status', "TEXT NOT NULL DEFAULT 'pending'"],
  ['processing_detail', "TEXT NOT NULL DEFAULT '{\"parse\":\"pending\",\"chunk\":\"pending\",\"bm25\":\"pending\",\"embedding\":\"pending\",\"summary\":\"pending\",\"mode\":\"full\"}'"],
  ['processing_error', "TEXT NOT NULL DEFAULT ''"],
  ['processing_updated_at', "TEXT DEFAULT NULL"],
];

function isMissingKbItemColumnError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = (error.message || '').toLowerCase();
  return message.includes('no such column:')
    || message.includes('has no column named');
}

function ensureKbItemRuntimeColumns(): void {
  if (kbItemRuntimeSchemaChecked) return;
  const db = getDb();
  try {
    const columns = db.prepare('PRAGMA table_info(kb_items)').all() as { name: string }[];
    const columnNames = new Set(columns.map((column) => column.name));
    for (const [column, definition] of KB_ITEM_RUNTIME_COLUMNS) {
      if (!columnNames.has(column)) {
        db.exec(`ALTER TABLE kb_items ADD COLUMN ${column} ${definition}`);
      }
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_kb_items_source_key ON kb_items(collection_id, source_key)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_kb_items_processing_status ON kb_items(processing_status)');
    kbItemRuntimeSchemaChecked = true;
  } catch (error) {
    // Keep compatibility with older or partially-migrated databases.
    if (!isMissingKbItemColumnError(error)) {
      console.warn('[kb/store] Failed to ensure kb_items runtime columns:', error);
    }
  }
}

// ---- Collections ----

export function createCollection(name: string, description = ''): KbCollection {
  const db = getDb();
  const id = genId();
  const ts = now();
  db.prepare(
    'INSERT INTO kb_collections (id,name,description,created_at,updated_at) VALUES (?,?,?,?,?)'
  ).run(id, name, description, ts, ts);
  return getCollection(id)!;
}

export function getCollection(id: string): KbCollection | undefined {
  return getDb().prepare('SELECT * FROM kb_collections WHERE id=?').get(id) as KbCollection | undefined;
}

export function listCollections(): KbCollection[] {
  return getDb().prepare('SELECT * FROM kb_collections ORDER BY created_at DESC').all() as KbCollection[];
}

export function updateCollection(id: string, updates: { name?: string; description?: string }) {
  const db = getDb();
  const ts = now();
  if (updates.name !== undefined) db.prepare('UPDATE kb_collections SET name=?,updated_at=? WHERE id=?').run(updates.name, ts, id);
  if (updates.description !== undefined) db.prepare('UPDATE kb_collections SET description=?,updated_at=? WHERE id=?').run(updates.description, ts, id);
  return getCollection(id);
}

export function deleteCollection(id: string): boolean {
  const db = getDb();
  const items = db.prepare('SELECT id FROM kb_items WHERE collection_id=?').all(id) as { id: string }[];
  for (const item of items) {
    deleteItem(item.id);
  }
  return db.prepare('DELETE FROM kb_collections WHERE id=?').run(id).changes > 0;
}

// ---- Items ----

export function addItem(collectionId: string, data: {
  title: string;
  source_type: string;
  source_path?: string;
  source_key?: string;
  content: string;
  tags?: string[];
  processing_status?: KbProcessingStatus;
  processing_detail?: string;
  processing_error?: string;
  processing_updated_at?: string | null;
  chunk_count?: number;
}): KbItem {
  ensureKbItemRuntimeColumns();
  const db = getDb();
  const id = genId();
  const ts = now();
  const values: unknown[] = [
    id,
    collectionId,
    data.title,
    data.source_type,
    data.source_path || '',
    data.source_key || '',
    data.content,
    JSON.stringify(data.tags || []),
    data.processing_status || 'pending',
    data.processing_detail || '{"parse":"pending","chunk":"pending","bm25":"pending","embedding":"pending","summary":"pending","mode":"full"}',
    data.processing_error || '',
    data.processing_updated_at || ts,
    Number.isFinite(data.chunk_count) ? data.chunk_count : 0,
    ts,
    ts,
  ];
  const insertSql = `INSERT INTO kb_items
      (id,collection_id,title,source_type,source_path,source_key,content,tags,processing_status,processing_detail,processing_error,processing_updated_at,chunk_count,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  try {
    db.prepare(insertSql).run(...values);
  } catch (error) {
    if (!isMissingKbItemColumnError(error)) {
      throw error;
    }
    kbItemRuntimeSchemaChecked = false;
    ensureKbItemRuntimeColumns();
    db.prepare(insertSql).run(...values);
  }
  return getItem(id)!;
}

export function findItemBySourceKey(collectionId: string, sourceKey: string): KbItem | undefined {
  if (!sourceKey) return undefined;
  ensureKbItemRuntimeColumns();
  try {
    return getDb()
      .prepare('SELECT * FROM kb_items WHERE collection_id=? AND source_key=? LIMIT 1')
      .get(collectionId, sourceKey) as KbItem | undefined;
  } catch (error) {
    if (isMissingKbItemColumnError(error)) {
      return undefined;
    }
    throw error;
  }
}

export function findItemBySource(collectionId: string, sourceType: string, sourcePath?: string): KbItem | undefined {
  if (!sourcePath) return undefined;
  return getDb()
    .prepare('SELECT * FROM kb_items WHERE collection_id=? AND source_type=? AND source_path=? LIMIT 1')
    .get(collectionId, sourceType, sourcePath) as KbItem | undefined;
}

export function getItem(id: string): KbItem | undefined {
  return getDb().prepare('SELECT * FROM kb_items WHERE id=?').get(id) as KbItem | undefined;
}

export function listItems(collectionId: string): KbItem[] {
  return getDb().prepare('SELECT * FROM kb_items WHERE collection_id=? ORDER BY updated_at DESC').all(collectionId) as KbItem[];
}

export function updateItem(id: string, updates: Partial<Pick<KbItem, 'title' | 'tags' | 'content'>>) {
  const db = getDb();
  const ts = now();
  const sets: string[] = ['updated_at=?'];
  const vals: unknown[] = [ts];
  if (updates.title !== undefined) { sets.push('title=?'); vals.push(updates.title); }
  if (updates.tags !== undefined) { sets.push('tags=?'); vals.push(updates.tags); }
  if (updates.content !== undefined) { sets.push('content=?'); vals.push(updates.content); }
  vals.push(id);
  db.prepare(`UPDATE kb_items SET ${sets.join(',')} WHERE id=?`).run(...vals);
  return getItem(id);
}

export function patchItem(id: string, updates: Record<string, unknown>) {
  const db = getDb();
  const ts = now();
  const sets: string[] = ['updated_at=?'];
  const vals: unknown[] = [ts];
  for (const [key, value] of Object.entries(updates)) {
    sets.push(`${key}=?`);
    vals.push(value);
  }
  vals.push(id);
  db.prepare(`UPDATE kb_items SET ${sets.join(',')} WHERE id=?`).run(...vals);
  return getItem(id);
}

export function updateItemProcessing(
  id: string,
  payload: {
    status?: KbProcessingStatus;
    detail?: string;
    error?: string;
    chunkCount?: number;
  },
) {
  ensureKbItemRuntimeColumns();
  const patch: Record<string, unknown> = {
    processing_updated_at: now(),
  };
  if (payload.status !== undefined) patch.processing_status = payload.status;
  if (payload.detail !== undefined) patch.processing_detail = payload.detail;
  if (payload.error !== undefined) patch.processing_error = payload.error;
  if (payload.chunkCount !== undefined) patch.chunk_count = Math.max(0, Math.floor(payload.chunkCount));
  return patchItem(id, patch);
}

export function deleteItem(id: string): boolean {
  const db = getDb();
  // Keep historical ingest records but detach item reference so reprocess can delete/recreate items.
  db.prepare('UPDATE kb_ingest_job_items SET item_id = NULL WHERE item_id = ?').run(id);
  // If relation graph is enabled, remove links pointing to this item before deleting it.
  db.prepare('DELETE FROM kb_relations WHERE source_item_id = ? OR target_item_id = ?').run(id, id);
  db.prepare("DELETE FROM kb_summaries WHERE scope = 'item' AND scope_id = ?").run(id);
  try {
    removeItemFromTagSystem(id);
  } catch (error) {
    console.warn('[kb/store] Failed to remove item tags:', error);
  }
  db.prepare('DELETE FROM kb_bm25_index WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE item_id=?)').run(id);
  db.prepare('DELETE FROM kb_chunks WHERE item_id=?').run(id);
  return db.prepare('DELETE FROM kb_items WHERE id=?').run(id).changes > 0;
}

function escapeSqlLike(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

export function deleteItemsBySourcePathPrefix(collectionId: string, sourcePathPrefix: string): number {
  const normalized = sourcePathPrefix.trim();
  if (!normalized) return 0;
  const escaped = escapeSqlLike(normalized);
  const likeForward = `${escaped}/%`;
  const likeBackward = `${escaped}\\\\%`;

  const rows = getDb()
    .prepare(`
      SELECT id
      FROM kb_items
      WHERE collection_id = ?
        AND (source_path = ? OR source_path LIKE ? ESCAPE '\\' OR source_path LIKE ? ESCAPE '\\')
    `)
    .all(collectionId, normalized, likeForward, likeBackward) as { id: string }[];

  let deleted = 0;
  for (const row of rows) {
    if (deleteItem(row.id)) deleted += 1;
  }
  return deleted;
}

// ---- Chunks ----

export function saveChunks(itemId: string, chunks: string[], embeddings?: (Buffer | null)[]) {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO kb_chunks (id,item_id,content,chunk_index,embedding,metadata) VALUES (?,?,?,?,?,?)'
  );
  const txn = db.transaction(() => {
    // Remove old inverted-index entries before replacing chunks.
    db.prepare('DELETE FROM kb_bm25_index WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE item_id=?)').run(itemId);
    // Remove old chunks first
    db.prepare('DELETE FROM kb_chunks WHERE item_id=?').run(itemId);
    for (let i = 0; i < chunks.length; i++) {
      stmt.run(genId(), itemId, chunks[i], i, embeddings?.[i] ?? null, '{}');
    }
  });
  txn();
}

export function clearChunks(itemId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM kb_chunks WHERE item_id=?').run(itemId);
}

export function getChunks(itemId: string): KbChunk[] {
  return getDb().prepare('SELECT * FROM kb_chunks WHERE item_id=? ORDER BY chunk_index').all(itemId) as KbChunk[];
}

export function updateChunkEmbedding(chunkId: string, embedding: Buffer) {
  getDb().prepare('UPDATE kb_chunks SET embedding=? WHERE id=?').run(embedding, chunkId);
}

export function getAllChunksWithEmbeddings(): KbChunk[] {
  return getDb().prepare('SELECT * FROM kb_chunks WHERE embedding IS NOT NULL').all() as KbChunk[];
}
