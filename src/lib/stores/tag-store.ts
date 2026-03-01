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
