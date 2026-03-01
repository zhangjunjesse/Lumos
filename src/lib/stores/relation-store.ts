/**
 * Relation store — CRUD for kb_relations
 */
import { getDb } from '@/lib/db';
import { genId, now } from './helpers';

export interface KbRelation {
  id: string;
  source_item_id: string;
  target_item_id: string;
  relation_type: string;
  strength: number;
  metadata: string;
  created_at: string;
}

export type RelationType = 'topic_similar' | 'time_related' | 'contradiction';

// ---- Relations ----

export function createRelation(input: {
  source_item_id: string;
  target_item_id: string;
  relation_type: RelationType;
  strength?: number;
  metadata?: Record<string, unknown>;
}): KbRelation {
  const db = getDb();
  const id = genId();
  const ts = now();
  db.prepare(`
    INSERT INTO kb_relations (id, source_item_id, target_item_id, relation_type, strength, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_item_id, target_item_id, relation_type) DO UPDATE SET
      strength = excluded.strength,
      metadata = excluded.metadata
  `).run(
    id, input.source_item_id, input.target_item_id,
    input.relation_type, input.strength ?? 0.0,
    JSON.stringify(input.metadata || {}), ts,
  );
  return getRelationByPair(
    input.source_item_id, input.target_item_id, input.relation_type
  )!;
}

export function getRelation(id: string): KbRelation | undefined {
  return getDb().prepare('SELECT * FROM kb_relations WHERE id = ?').get(id) as KbRelation | undefined;
}

export function getRelationByPair(
  sourceId: string, targetId: string, relationType: string,
): KbRelation | undefined {
  return getDb().prepare(
    'SELECT * FROM kb_relations WHERE source_item_id = ? AND target_item_id = ? AND relation_type = ?'
  ).get(sourceId, targetId, relationType) as KbRelation | undefined;
}

export function getRelationsForItem(itemId: string, opts?: {
  relation_type?: RelationType; minStrength?: number;
}): KbRelation[] {
  const wheres = ['(source_item_id = ? OR target_item_id = ?)'];
  const params: unknown[] = [itemId, itemId];
  if (opts?.relation_type) {
    wheres.push('relation_type = ?');
    params.push(opts.relation_type);
  }
  if (opts?.minStrength !== undefined) {
    wheres.push('strength >= ?');
    params.push(opts.minStrength);
  }
  return getDb().prepare(
    `SELECT * FROM kb_relations WHERE ${wheres.join(' AND ')} ORDER BY strength DESC`
  ).all(...params) as KbRelation[];
}

export function deleteRelation(id: string): boolean {
  return getDb().prepare(
    'DELETE FROM kb_relations WHERE id = ?'
  ).run(id).changes > 0;
}

export function deleteRelationsForItem(itemId: string): number {
  return getDb().prepare(
    'DELETE FROM kb_relations WHERE source_item_id = ? OR target_item_id = ?'
  ).run(itemId, itemId).changes;
}
