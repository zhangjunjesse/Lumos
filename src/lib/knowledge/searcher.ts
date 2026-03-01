/**
 * Hybrid search — vector + BM25 with RRF fusion
 * Enhanced: time-aware retrieval (P0) + summary-level retrieval (P0)
 */
import { getDb } from '@/lib/db';
import { embedQuery, bufferToVector } from './embedder';
import * as bm25 from './bm25';
import { rewriteQuery } from './query-rewriter';
import type { SearchResult, KbChunk, SearchOptions, TimeFilter } from './types';

const RRF_K = 60;

interface RankedItem { chunkId: string; score: number }

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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

// ---- Time expression parser ----

const TIME_PATTERNS: [RegExp, (m: RegExpMatchArray) => TimeFilter][] = [
  [/上周/, () => weekOffset(-1)],
  [/本周/, () => weekOffset(0)],
  [/上个?月/, () => monthOffset(-1)],
  [/本月/, () => monthOffset(0)],
  [/最近(\d+)天/, (m) => daysAgo(Number(m[1]))],
  [/最近一周/, () => daysAgo(7)],
  [/最近一个?月/, () => daysAgo(30)],
  [/(\d{4})年(\d{1,2})月/, (m) => ({
    from: `${m[1]}-${m[2].padStart(2, '0')}-01`,
    to: endOfMonth(Number(m[1]), Number(m[2])),
  })],
];

function daysAgo(n: number): TimeFilter {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return { from: d.toISOString().slice(0, 10) };
}

function weekOffset(offset: number): TimeFilter {
  const now = new Date();
  const day = now.getDay() || 7;
  const mon = new Date(now);
  mon.setDate(now.getDate() - day + 1 + offset * 7);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: mon.toISOString().slice(0, 10), to: sun.toISOString().slice(0, 10) };
}

function monthOffset(offset: number): TimeFilter {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1 + offset;
  return {
    from: `${y}-${String(m).padStart(2, '0')}-01`,
    to: endOfMonth(y, m),
  };
}

function endOfMonth(y: number, m: number): string {
  const d = new Date(y, m, 0);
  return d.toISOString().slice(0, 10);
}

/** Parse time expressions from query text */
export function parseTimeFilter(query: string): TimeFilter | null {
  for (const [re, fn] of TIME_PATTERNS) {
    const m = query.match(re);
    if (m) return fn(m);
  }
  return null;
}

// ---- Time-filtered item IDs ----

function getTimeFilteredItemIds(tf: TimeFilter): Set<string> {
  const db = getDb();
  const conditions: string[] = [];
  const params: string[] = [];

  if (tf.from) {
    conditions.push('(doc_date >= ? OR created_at >= ?)');
    params.push(tf.from, tf.from);
  }
  if (tf.to) {
    conditions.push('(doc_date <= ? OR created_at <= ?)');
    params.push(tf.to + 'T23:59:59', tf.to + 'T23:59:59');
  }

  if (!conditions.length) return new Set();

  const rows = db.prepare(
    `SELECT id FROM kb_items WHERE ${conditions.join(' AND ')}`
  ).all(...params) as { id: string }[];

  return new Set(rows.map(r => r.id));
}

// ---- Vector search (chunk-level) ----

function vectorSearch(queryVec: number[], topK = 20): RankedItem[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT id, embedding FROM kb_chunks WHERE embedding IS NOT NULL'
  ).all() as Pick<KbChunk, 'id' | 'embedding'>[];

  return rows
    .map(r => ({
      chunkId: r.id,
      score: cosineSimilarity(queryVec, bufferToVector(r.embedding!)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

// ---- Summary-level search (two-stage: summary → chunks) ----

function summarySearch(queryVec: number[], topK = 10): RankedItem[] {
  const db = getDb();
  const items = db.prepare(
    'SELECT id, summary_embedding FROM kb_items WHERE summary_embedding IS NOT NULL'
  ).all() as { id: string; summary_embedding: Buffer }[];

  const ranked = items
    .map(r => ({
      itemId: r.id,
      score: cosineSimilarity(queryVec, bufferToVector(r.summary_embedding)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // Expand matched items to their best chunks
  const results: RankedItem[] = [];
  for (const r of ranked) {
    const chunks = db.prepare(
      'SELECT id FROM kb_chunks WHERE item_id=? AND embedding IS NOT NULL ORDER BY chunk_index LIMIT 3'
    ).all(r.itemId) as { id: string }[];
    for (const c of chunks) {
      results.push({ chunkId: c.id, score: r.score });
    }
  }
  return results;
}

// ---- RRF fusion ----

function rrfFuse(lists: RankedItem[][]): RankedItem[] {
  const scores: Record<string, { chunkId: string; score: number }> = {};
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const r = list[rank];
      if (!scores[r.chunkId]) scores[r.chunkId] = { chunkId: r.chunkId, score: 0 };
      scores[r.chunkId].score += 1 / (RRF_K + rank + 1);
    }
  }
  return Object.values(scores).sort((a, b) => b.score - a.score);
}

// ---- Enrich results with metadata ----

function enrichResults(
  ranked: RankedItem[],
  topK: number,
  allowedItemIds?: Set<string>,
): SearchResult[] {
  if (!ranked.length) return [];
  const db = getDb();
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  for (const r of ranked) {
    if (results.length >= topK) break;
    const row = db.prepare(`
      SELECT c.content, i.title, i.source_path, i.source_type,
             i.id as item_id, col.name as collection_name
      FROM kb_chunks c
      JOIN kb_items i ON c.item_id = i.id
      JOIN kb_collections col ON i.collection_id = col.id
      WHERE c.id = ?
    `).get(r.chunkId) as {
      content: string; title: string; source_path: string;
      source_type: string; item_id: string; collection_name: string;
    } | undefined;

    if (!row) continue;
    if (seen.has(row.item_id)) continue;
    if (allowedItemIds && !allowedItemIds.has(row.item_id)) continue;

    seen.add(row.item_id);
    results.push({
      chunk_content: row.content,
      item_title: row.title,
      source_path: row.source_path,
      source_type: row.source_type,
      score: Math.round(r.score * 10000) / 100,
      collection_name: row.collection_name,
    });
  }
  return results;
}

// ---- Main search entry ----

/** Enhanced search: time-aware + summary-level + hybrid (backward-compatible) */
export async function searchAll(
  query: string,
  topKOrOpts: number | SearchOptions = 5,
): Promise<SearchResult[]> {
  const opts: SearchOptions = typeof topKOrOpts === 'number'
    ? { topK: topKOrOpts }
    : topKOrOpts;
  const topK = opts.topK ?? 5;

  // 1. Auto-detect time filter from query
  const timeFilter = opts.timeFilter ?? parseTimeFilter(query);
  const allowedIds = timeFilter ? getTimeFilteredItemIds(timeFilter) : undefined;

  // 2. Query rewrite
  let queries: string[];
  try {
    queries = await withTimeout(rewriteQuery(query), 6000);
  } catch {
    queries = [query];
  }

  const allLists: RankedItem[][] = [];

  // 3. For each query variant, run hybrid search
  for (const q of queries) {
    let vec: number[] | null = null;
    try { vec = await withTimeout(embedQuery(q), 10000); } catch { /* skip */ }

    if (vec) {
      // Summary-level search (two-stage)
      const summaryResults = summarySearch(vec);
      if (summaryResults.length) allLists.push(summaryResults);

      // Chunk-level vector search
      allLists.push(vectorSearch(vec));
    }

    // BM25 keyword search
    const bResults = bm25.search(q);
    if (bResults.length) allLists.push(bResults);
  }

  const fused = allLists.length ? rrfFuse(allLists) : [];
  return enrichResults(fused, topK, allowedIds);
}

/** Format results as context for AI prompt */
export function buildContext(results: SearchResult[]): string {
  if (!results.length) return '';
  const lines = results.map((r, i) =>
    `${i + 1}. 《${r.item_title}》(相关度: ${r.score}%)\n   来源: ${r.source_path || r.source_type}\n   内容: ${r.chunk_content.slice(0, 200)}...`
  );
  return `[知识库检索结果]\n${lines.join('\n')}`;
}