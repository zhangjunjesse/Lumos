/**
 * Knowledge store — SQLite CRUD for collections, items, chunks
 * Replaces demo's JSON-file-based store
 */
import { getDb } from '@/lib/db';
import { genId, now } from '@/lib/stores/helpers';
import type { KbCollection, KbItem, KbChunk } from './types';

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
  // Cascade: delete items and their chunks
  const items = db.prepare('SELECT id FROM kb_items WHERE collection_id=?').all(id) as { id: string }[];
  for (const item of items) {
    db.prepare('DELETE FROM kb_bm25_index WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE item_id=?)').run(item.id);
    db.prepare('DELETE FROM kb_chunks WHERE item_id=?').run(item.id);
  }
  db.prepare('DELETE FROM kb_items WHERE collection_id=?').run(id);
  return db.prepare('DELETE FROM kb_collections WHERE id=?').run(id).changes > 0;
}

// ---- Items ----

export function addItem(collectionId: string, data: {
  title: string; source_type: string; source_path?: string; content: string; tags?: string[];
}): KbItem {
  const db = getDb();
  const id = genId();
  const ts = now();
  db.prepare(
    'INSERT INTO kb_items (id,collection_id,title,source_type,source_path,content,tags,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(id, collectionId, data.title, data.source_type, data.source_path || '', data.content, JSON.stringify(data.tags || []), ts, ts);
  return getItem(id)!;
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

export function deleteItem(id: string): boolean {
  const db = getDb();
  db.prepare('DELETE FROM kb_bm25_index WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE item_id=?)').run(id);
  db.prepare('DELETE FROM kb_chunks WHERE item_id=?').run(id);
  return db.prepare('DELETE FROM kb_items WHERE id=?').run(id).changes > 0;
}

// ---- Chunks ----

export function saveChunks(itemId: string, chunks: string[], embeddings?: (Buffer | null)[]) {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT INTO kb_chunks (id,item_id,content,chunk_index,embedding,metadata) VALUES (?,?,?,?,?,?)'
  );
  const txn = db.transaction(() => {
    // Remove old chunks first
    db.prepare('DELETE FROM kb_chunks WHERE item_id=?').run(itemId);
    for (let i = 0; i < chunks.length; i++) {
      stmt.run(genId(), itemId, chunks[i], i, embeddings?.[i] ?? null, '{}');
    }
  });
  txn();
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
