/**
 * Tag store — CRUD for kb_tags + kb_item_tags
 */
import { getDb } from '@/lib/db';
import { genId, now } from './helpers';

export interface KbTag {
  id: string;
  name: string;
  category: string;
  color: string;
  usage_count: number;
  created_at: string;
}

export interface KbItemTag {
  item_id: string;
  tag_id: string;
  confidence: number;
  source: string;
  created_at: string;
}

export type TagCategory = 'domain' | 'tech' | 'doctype' | 'project' | 'custom';

// ---- Tags ----

export function createTag(name: string, opts?: {
  category?: TagCategory; color?: string;
}): KbTag {
  const db = getDb();
  const id = genId();
  const ts = now();
  db.prepare(`
    INSERT INTO kb_tags (id, name, category, color, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, name, opts?.category || 'custom', opts?.color || '#6B7280', ts);
  return getTag(id)!;
}

export function getTag(id: string): KbTag | undefined {
  return getDb().prepare('SELECT * FROM kb_tags WHERE id = ?').get(id) as KbTag | undefined;
}

export function getTagByName(name: string): KbTag | undefined {
  return getDb().prepare('SELECT * FROM kb_tags WHERE name = ?').get(name) as KbTag | undefined;
}

export function listTags(opts?: {
  category?: TagCategory;
}): KbTag[] {
  if (opts?.category) {
    return getDb().prepare(
      'SELECT * FROM kb_tags WHERE category = ? ORDER BY usage_count DESC'
    ).all(opts.category) as KbTag[];
  }
  return getDb().prepare(
    'SELECT * FROM kb_tags ORDER BY usage_count DESC'
  ).all() as KbTag[];
}

export function updateTag(id: string, updates: Partial<{
  name: string; category: TagCategory; color: string;
}>): KbTag | undefined {
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); vals.push(updates.name); }
  if (updates.category !== undefined) { sets.push('category = ?'); vals.push(updates.category); }
  if (updates.color !== undefined) { sets.push('color = ?'); vals.push(updates.color); }
  if (sets.length === 0) return getTag(id);
  vals.push(id);
  db.prepare(`UPDATE kb_tags SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getTag(id);
}

export function deleteTag(id: string): boolean {
  const db = getDb();
  db.prepare('DELETE FROM kb_item_tags WHERE tag_id = ?').run(id);
  return db.prepare('DELETE FROM kb_tags WHERE id = ?').run(id).changes > 0;
}

// ---- Item-Tag Associations ----

export function addItemTag(itemId: string, tagId: string, opts?: {
  confidence?: number; source?: 'manual' | 'ai_auto';
}): void {
  const db = getDb();
  const ts = now();
  const existing = db.prepare(
    'SELECT 1 FROM kb_item_tags WHERE item_id = ? AND tag_id = ?'
  ).get(itemId, tagId);
  db.prepare(`
    INSERT INTO kb_item_tags (item_id, tag_id, confidence, source, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(item_id, tag_id) DO UPDATE SET
      confidence = excluded.confidence, source = excluded.source
  `).run(itemId, tagId, opts?.confidence ?? 1.0, opts?.source || 'manual', ts);
  if (!existing) {
    db.prepare('UPDATE kb_tags SET usage_count = usage_count + 1 WHERE id = ?').run(tagId);
  }
}

export function removeItemTag(itemId: string, tagId: string): boolean {
  const db = getDb();
  const result = db.prepare(
    'DELETE FROM kb_item_tags WHERE item_id = ? AND tag_id = ?'
  ).run(itemId, tagId);
  if (result.changes > 0) {
    db.prepare('UPDATE kb_tags SET usage_count = MAX(0, usage_count - 1) WHERE id = ?').run(tagId);
  }
  return result.changes > 0;
}

export function getItemTags(itemId: string): (KbItemTag & { tag_name: string; tag_color: string })[] {
  return getDb().prepare(`
    SELECT it.*, t.name as tag_name, t.color as tag_color
    FROM kb_item_tags it JOIN kb_tags t ON it.tag_id = t.id
    WHERE it.item_id = ?
    ORDER BY it.confidence DESC
  `).all(itemId) as (KbItemTag & { tag_name: string; tag_color: string })[];
}

export function getItemsByTag(tagId: string): string[] {
  const rows = getDb().prepare(
    'SELECT item_id FROM kb_item_tags WHERE tag_id = ? ORDER BY created_at DESC'
  ).all(tagId) as { item_id: string }[];
  return rows.map(r => r.item_id);
}

/**
 * Merge tag `fromId` into `toId`:
 *  - move each kb_item_tags row from fromId to toId (skip if target already has it)
 *  - drop kb_tags.fromId
 *  - rebuild usage_count on toId from kb_item_tags (authoritative)
 * Returns the number of items that ended up with the target tag added (rough "affected items").
 */
export function mergeTag(fromId: string, toId: string): { merged: number } {
  if (!fromId || !toId || fromId === toId) return { merged: 0 };
  const db = getDb();
  const fromTag = getTag(fromId);
  const toTag = getTag(toId);
  if (!fromTag || !toTag) return { merged: 0 };

  let merged = 0;
  const tx = db.transaction(() => {
    const rows = db.prepare(
      'SELECT item_id, confidence, source, created_at FROM kb_item_tags WHERE tag_id = ?',
    ).all(fromId) as Array<{ item_id: string; confidence: number; source: string; created_at: string }>;

    const hasTarget = db.prepare(
      'SELECT 1 FROM kb_item_tags WHERE item_id = ? AND tag_id = ? LIMIT 1',
    );
    const insertTarget = db.prepare(`
      INSERT INTO kb_item_tags (item_id, tag_id, confidence, source, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const deleteSource = db.prepare(
      'DELETE FROM kb_item_tags WHERE item_id = ? AND tag_id = ?',
    );

    for (const row of rows) {
      const exists = Boolean(hasTarget.get(row.item_id, toId));
      if (!exists) {
        insertTarget.run(row.item_id, toId, row.confidence, row.source, row.created_at);
        merged += 1;
      }
      deleteSource.run(row.item_id, fromId);
    }

    db.prepare('DELETE FROM kb_tags WHERE id = ?').run(fromId);
    const count = db.prepare(
      'SELECT COUNT(*) AS n FROM kb_item_tags WHERE tag_id = ?',
    ).get(toId) as { n: number };
    db.prepare('UPDATE kb_tags SET usage_count = ? WHERE id = ?').run(count.n, toId);
  });
  tx();
  return { merged };
}

/** Sync item.tags JSON column from current kb_item_tags state (used after merge/rename). */
export function rebuildItemTagsJson(itemIds: string[]): void {
  if (itemIds.length === 0) return;
  const db = getDb();
  const selectNames = db.prepare(`
    SELECT t.name FROM kb_item_tags it
    JOIN kb_tags t ON t.id = it.tag_id
    WHERE it.item_id = ?
    ORDER BY it.confidence DESC, t.name ASC
  `);
  const updateItem = db.prepare('UPDATE kb_items SET tags = ?, updated_at = ? WHERE id = ?');
  const ts = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const id of itemIds) {
      const rows = selectNames.all(id) as Array<{ name: string }>;
      updateItem.run(JSON.stringify(rows.map(r => r.name)), ts, id);
    }
  });
  tx();
}
