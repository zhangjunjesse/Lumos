/**
 * Relation finder — discover topic and temporal relations between documents
 * Pure local computation, no API cost
 */
import crypto from 'crypto';
import { getDb } from '@/lib/db';
import { bufferToVector } from './embedder';
import type { DocumentRelation } from './types';

const TOPIC_THRESHOLD = 0.7;
const TEMPORAL_DAYS = 7;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

interface ItemWithEmbedding {
  id: string;
  tags: string;
  doc_date: string | null;
  summary_embedding: Buffer | null;
}

function saveRelation(
  sourceId: string,
  targetId: string,
  type: 'topic_similar' | 'time_related',
  strength: number,
) {
  const db = getDb();
  const id = crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO kb_relations
      (id, source_item_id, target_item_id, relation_type, strength, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, sourceId, targetId, type, strength, now);
}

/** Find topic relations via summary embedding cosine similarity */
export function findTopicRelations(itemId?: string): DocumentRelation[] {
  const db = getDb();
  const items = db.prepare(
    'SELECT id, tags, doc_date, summary_embedding FROM kb_items WHERE summary_embedding IS NOT NULL'
  ).all() as ItemWithEmbedding[];

  if (items.length < 2) return [];

  const relations: DocumentRelation[] = [];
  const targets = itemId ? items.filter(i => i.id === itemId) : items;

  for (const source of targets) {
    if (!source.summary_embedding) continue;
    const srcVec = bufferToVector(source.summary_embedding);

    for (const target of items) {
      if (target.id <= source.id) continue;
      if (!target.summary_embedding) continue;

      const sim = cosineSimilarity(srcVec, bufferToVector(target.summary_embedding));
      if (sim >= TOPIC_THRESHOLD) {
        saveRelation(source.id, target.id, 'topic_similar', sim);
        relations.push({
          sourceItemId: source.id,
          targetItemId: target.id,
          relationType: 'topic_similar',
          score: Math.round(sim * 1000) / 1000,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }
  return relations;
}

function parseTags(tagsJson: string): string[] {
  try {
    const arr = JSON.parse(tagsJson);
    return Array.isArray(arr) ? arr.filter((t: unknown) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

/** Find temporal relations — documents created within TEMPORAL_DAYS of each other */
function findTemporalRelations(): DocumentRelation[] {
  const db = getDb();
  const items = db.prepare(
    'SELECT id, tags, doc_date, summary_embedding FROM kb_items WHERE doc_date IS NOT NULL'
  ).all() as ItemWithEmbedding[];

  if (items.length < 2) return [];

  const relations: DocumentRelation[] = [];
  const msThreshold = TEMPORAL_DAYS * 86_400_000;

  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    const aTime = new Date(a.doc_date!).getTime();
    if (isNaN(aTime)) continue;

    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      const bTime = new Date(b.doc_date!).getTime();
      if (isNaN(bTime)) continue;

      const diff = Math.abs(aTime - bTime);
      if (diff <= msThreshold) {
        const score = 1 - diff / msThreshold;
        saveRelation(a.id, b.id, 'time_related', score);
        relations.push({
          sourceItemId: a.id,
          targetItemId: b.id,
          relationType: 'time_related',
          score: Math.round(score * 1000) / 1000,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }
  return relations;
}

/** Run all relation discovery (topic + temporal) */
export function discoverRelations(itemId?: string): DocumentRelation[] {
  const topic = findTopicRelations(itemId);
  const temporal = findTemporalRelations();
  return [...topic, ...temporal];
}

/** Get existing relations for an item */
export function getRelationsForItem(itemId: string): DocumentRelation[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT source_item_id, target_item_id, relation_type, strength, created_at
    FROM kb_relations
    WHERE source_item_id=? OR target_item_id=?
  `).all(itemId, itemId) as {
    source_item_id: string;
    target_item_id: string;
    relation_type: string;
    strength: number;
    created_at: string;
  }[];

  return rows.map(r => ({
    sourceItemId: r.source_item_id,
    targetItemId: r.target_item_id,
    relationType: r.relation_type as 'topic_similar' | 'time_related',
    score: r.strength,
    createdAt: r.created_at,
  }));
}