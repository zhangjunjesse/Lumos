import { getDb } from '@/lib/db';
import { genId, now } from '@/lib/stores/helpers';
import type { CategorizedTag, TagCategory } from './types';

type TagSource = 'manual' | 'ai_auto' | 'system';

export interface TagSystemCandidate {
  name: string;
  category: TagCategory;
  confidence: number;
  source: TagSource;
}

const CATEGORY_COLOR_MAP: Record<TagCategory, string> = {
  domain: '#2563EB',
  tech: '#7C3AED',
  doctype: '#0EA5E9',
  project: '#16A34A',
  custom: '#6B7280',
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeTagName(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 30);
}

function normalizeTagKey(value: string): string {
  return normalizeTagName(value).toLowerCase();
}

function chooseBetterCandidate(
  current: TagSystemCandidate | undefined,
  next: TagSystemCandidate,
): TagSystemCandidate {
  if (!current) return next;
  if (next.category !== 'custom' && current.category === 'custom') return next;
  if (next.confidence > current.confidence) return next;
  return current;
}

function normalizeCandidates(candidates: TagSystemCandidate[]): TagSystemCandidate[] {
  const map = new Map<string, TagSystemCandidate>();
  for (const candidate of candidates) {
    const name = normalizeTagName(candidate.name);
    if (!name) continue;
    const key = normalizeTagKey(name);
    const normalized: TagSystemCandidate = {
      name,
      category: candidate.category || 'custom',
      confidence: clamp(candidate.confidence, 0, 1),
      source: candidate.source || 'manual',
    };
    map.set(key, chooseBetterCandidate(map.get(key), normalized));
  }
  return Array.from(map.values());
}

export function buildTagCandidates(
  tags: string[],
  aiTags: CategorizedTag[] = [],
): TagSystemCandidate[] {
  const aiMap = new Map<string, CategorizedTag>();
  for (const tag of aiTags) {
    const name = normalizeTagName(tag.name);
    if (!name) continue;
    aiMap.set(normalizeTagKey(name), {
      ...tag,
      name,
      category: tag.category || 'custom',
      confidence: clamp(tag.confidence, 0, 1),
    });
  }

  const merged: TagSystemCandidate[] = [];
  for (const rawTag of tags) {
    const name = normalizeTagName(rawTag);
    if (!name) continue;
    const key = normalizeTagKey(name);
    const ai = aiMap.get(key);
    if (ai) {
      merged.push({
        name,
        category: ai.category || 'custom',
        confidence: clamp(ai.confidence, 0, 1),
        source: 'ai_auto',
      });
      continue;
    }
    merged.push({
      name,
      category: 'custom',
      confidence: 1,
      source: 'manual',
    });
  }

  return normalizeCandidates(merged);
}

function removeTagAssociations(itemId: string): void {
  const db = getDb();
  const tagRows = db.prepare(
    'SELECT tag_id FROM kb_item_tags WHERE item_id = ?',
  ).all(itemId) as Array<{ tag_id: string }>;

  if (tagRows.length === 0) return;

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM kb_item_tags WHERE item_id = ?').run(itemId);
    const decrement = db.prepare('UPDATE kb_tags SET usage_count = MAX(0, usage_count - 1) WHERE id = ?');
    for (const row of tagRows) {
      decrement.run(row.tag_id);
    }
    db.prepare(
      'DELETE FROM kb_tags WHERE usage_count <= 0 AND id NOT IN (SELECT tag_id FROM kb_item_tags)',
    ).run();
  });

  tx();
}

export function removeItemFromTagSystem(itemId: string): void {
  removeTagAssociations(itemId);
}

export function syncItemTagSystem(itemId: string, candidates: TagSystemCandidate[]): void {
  const db = getDb();
  const normalized = normalizeCandidates(candidates);

  const tx = db.transaction(() => {
    const existingRows = db.prepare(`
      SELECT it.tag_id, t.name
      FROM kb_item_tags it
      JOIN kb_tags t ON t.id = it.tag_id
      WHERE it.item_id = ?
    `).all(itemId) as Array<{ tag_id: string; name: string }>;

    const existingByName = new Map<string, { tag_id: string; name: string }>();
    for (const row of existingRows) {
      existingByName.set(normalizeTagKey(row.name), row);
    }

    const desiredByName = new Map<string, TagSystemCandidate>();
    for (const candidate of normalized) {
      desiredByName.set(normalizeTagKey(candidate.name), candidate);
    }

    // Remove obsolete associations first.
    for (const [key, row] of existingByName.entries()) {
      if (desiredByName.has(key)) continue;
      db.prepare('DELETE FROM kb_item_tags WHERE item_id = ? AND tag_id = ?').run(itemId, row.tag_id);
      db.prepare('UPDATE kb_tags SET usage_count = MAX(0, usage_count - 1) WHERE id = ?').run(row.tag_id);
    }

    const selectTagByName = db.prepare(
      'SELECT id, category FROM kb_tags WHERE name = ? LIMIT 1',
    );
    const insertTag = db.prepare(
      'INSERT INTO kb_tags (id, name, category, color, usage_count, created_at) VALUES (?, ?, ?, ?, 0, ?)',
    );
    const updateTagMeta = db.prepare(
      'UPDATE kb_tags SET category = ?, color = ? WHERE id = ?',
    );
    const selectAssoc = db.prepare(
      'SELECT 1 FROM kb_item_tags WHERE item_id = ? AND tag_id = ? LIMIT 1',
    );
    const upsertAssoc = db.prepare(`
      INSERT INTO kb_item_tags (item_id, tag_id, confidence, source, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(item_id, tag_id) DO UPDATE SET
        confidence = excluded.confidence,
        source = excluded.source
    `);
    const incUsage = db.prepare('UPDATE kb_tags SET usage_count = usage_count + 1 WHERE id = ?');

    const ts = now();
    for (const candidate of desiredByName.values()) {
      const existing = selectTagByName.get(candidate.name) as { id: string; category: TagCategory } | undefined;
      let tagId = existing?.id;

      if (!tagId) {
        tagId = genId();
        insertTag.run(
          tagId,
          candidate.name,
          candidate.category,
          CATEGORY_COLOR_MAP[candidate.category] || CATEGORY_COLOR_MAP.custom,
          ts,
        );
      } else if (existing.category === 'custom' && candidate.category !== 'custom') {
        updateTagMeta.run(
          candidate.category,
          CATEGORY_COLOR_MAP[candidate.category] || CATEGORY_COLOR_MAP.custom,
          tagId,
        );
      }

      const assocExists = Boolean(selectAssoc.get(itemId, tagId));
      upsertAssoc.run(itemId, tagId, clamp(candidate.confidence, 0, 1), candidate.source, ts);
      if (!assocExists) {
        incUsage.run(tagId);
      }
    }

    db.prepare(
      'DELETE FROM kb_tags WHERE usage_count <= 0 AND id NOT IN (SELECT tag_id FROM kb_item_tags)',
    ).run();
  });

  tx();
}
