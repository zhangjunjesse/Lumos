/**
 * Quality-first, lightweight retrieval:
 * summary-level candidate recall -> chunk-level rerank.
 */
import { getDb, getSetting } from '@/lib/db';
import { embedQuery, bufferToVector } from './embedder';
import * as bm25 from './bm25';
import { rewriteQuery } from './query-rewriter';
import type { SearchResult, SearchOptions, TimeFilter } from './types';

const MAX_QUERY_VARIANTS = 4;
const MAX_QUERY_TERMS = 8;
const MAX_TITLE_PATH_TOKEN_FILTER = 6;
const MIN_CANDIDATE_POOL = 16;
const MAX_CANDIDATE_POOL = 120;
const REFERENCE_DEFAULT_POOL = 28;
const ENHANCED_DEFAULT_POOL = 40;

interface QueryPlan {
  embedding: number[] | null;
  bm25Results: Array<{ chunkId: string; score: number }>;
}

interface SummaryEmbeddingRow {
  itemId: string;
  embedding: number[];
}

interface ItemMeta {
  itemId: string;
  title: string;
  sourcePath: string;
  sourceType: string;
  collectionName: string;
  summary: string;
}

interface ChunkMeta extends ItemMeta {
  chunkId: string;
  chunkIndex: number;
  content: string;
  embedding: Buffer | null;
}

interface ScoredChunk extends ChunkMeta {
  score: number;
  vectorScore: number;
  bm25Score: number;
  summaryScore: number;
  titlePathScore: number;
  coverageScore: number;
}

export interface SearchRunMeta {
  queryVariants: string[];
  retrievalMode: 'reference' | 'enhanced';
  timeFilter: TimeFilter | null;
  candidateItems: number;
  candidateChunks: number;
}

export interface SearchRunOutput {
  results: SearchResult[];
  meta: SearchRunMeta;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeScore(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return clamp((raw + 1) / 2, 0, 1);
}

function normalizeMap(values: Map<string, number>): Map<string, number> {
  let max = 0;
  for (const value of values.values()) {
    if (value > max) max = value;
  }
  if (max <= 0) {
    return new Map(Array.from(values.entries()).map(([key]) => [key, 0]));
  }
  const normalized = new Map<string, number>();
  for (const [key, value] of values.entries()) {
    normalized.set(key, clamp(value / max, 0, 1));
  }
  return normalized;
}

function mergeMax(target: Map<string, number>, id: string, value: number): void {
  const prev = target.get(id);
  if (prev === undefined || value > prev) {
    target.set(id, value);
  }
}

function escapeSqlLike(value: string): string {
  return value.replace(/([!%_])/g, '!$1');
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
  const base = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const year = base.getFullYear();
  const month = base.getMonth() + 1;
  return {
    from: `${year}-${String(month).padStart(2, '0')}-01`,
    to: endOfMonth(year, month),
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

// ---- Item filter ----

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
    params.push(`${tf.to}T23:59:59`, `${tf.to}T23:59:59`);
  }

  if (!conditions.length) return new Set();
  const rows = db.prepare(
    `SELECT id FROM kb_items WHERE health_status != 'archived' AND ${conditions.join(' AND ')}`
  ).all(...params) as { id: string }[];

  return new Set(rows.map((row) => row.id));
}

function getDefaultRetrievalMode(): 'reference' | 'enhanced' {
  return (getSetting('kb_retrieval_mode') || '').trim().toLowerCase() === 'enhanced'
    ? 'enhanced'
    : 'reference';
}

function getCandidatePoolSize(mode: 'reference' | 'enhanced', topK: number): number {
  const fromSetting = Number(getSetting('kb_candidate_pool_size') || '');
  if (Number.isFinite(fromSetting) && fromSetting > 0) {
    return clamp(Math.floor(fromSetting), MIN_CANDIDATE_POOL, MAX_CANDIDATE_POOL);
  }
  const base = mode === 'reference' ? REFERENCE_DEFAULT_POOL : ENHANCED_DEFAULT_POOL;
  return clamp(Math.max(base, topK * 6), MIN_CANDIDATE_POOL, MAX_CANDIDATE_POOL);
}

function dedupeQueries(queries: string[]): string[] {
  const uniq = new Set<string>();
  for (const query of queries) {
    const normalized = query.replace(/\s+/g, ' ').trim();
    if (!normalized) continue;
    uniq.add(normalized);
    if (uniq.size >= MAX_QUERY_VARIANTS) break;
  }
  return Array.from(uniq);
}

function extractQueryTerms(queries: string[]): string[] {
  const terms = new Set<string>();
  for (const query of queries) {
    for (const token of bm25.tokenize(query)) {
      const normalized = token.trim();
      if (!normalized) continue;
      terms.add(normalized);
      if (terms.size >= MAX_QUERY_TERMS) break;
    }
    if (terms.size >= MAX_QUERY_TERMS) break;
  }
  return Array.from(terms);
}

function termCoverageScore(text: string, terms: string[]): { score: number; matched: string[] } {
  if (!text || !terms.length) return { score: 0, matched: [] };
  const lower = text.toLowerCase();
  const matched: string[] = [];
  for (const term of terms) {
    if (lower.includes(term.toLowerCase())) {
      matched.push(term);
    }
  }
  return {
    score: clamp(matched.length / Math.max(terms.length, 1), 0, 1),
    matched,
  };
}

function loadSummaryEmbeddings(allowedItemIds?: Set<string>): SummaryEmbeddingRow[] {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, summary_embedding
     FROM kb_items
     WHERE summary_embedding IS NOT NULL AND health_status != 'archived'`
  ).all() as { id: string; summary_embedding: Buffer }[];

  return rows
    .filter((row) => !allowedItemIds || allowedItemIds.has(row.id))
    .map((row) => ({
      itemId: row.id,
      embedding: bufferToVector(row.summary_embedding),
    }));
}

function summarySearchItems(
  queryVec: number[],
  embeddings: SummaryEmbeddingRow[],
  topK: number,
): Array<{ itemId: string; score: number }> {
  const ranked = embeddings
    .map((row) => ({
      itemId: row.itemId,
      score: cosineSimilarity(queryVec, row.embedding),
    }))
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, topK);
}

function lookupChunkItemMap(chunkIds: string[]): Map<string, string> {
  if (!chunkIds.length) return new Map();
  const db = getDb();
  const placeholders = chunkIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT id, item_id FROM kb_chunks WHERE id IN (${placeholders})`
  ).all(...chunkIds) as { id: string; item_id: string }[];
  return new Map(rows.map((row) => [row.id, row.item_id]));
}

function searchTitlePathCandidates(
  terms: string[],
  limit: number,
  allowedItemIds?: Set<string>,
): Map<string, number> {
  if (!terms.length) return new Map();
  const db = getDb();
  const filtered = terms
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, MAX_TITLE_PATH_TOKEN_FILTER);
  if (!filtered.length) return new Map();

  const whereParts: string[] = [];
  const params: string[] = [];
  for (const term of filtered) {
    const like = `%${escapeSqlLike(term)}%`;
    whereParts.push("(title LIKE ? ESCAPE '!' OR source_path LIKE ? ESCAPE '!')");
    params.push(like, like);
  }

  const rows = db.prepare(
    `SELECT id, title, source_path
     FROM kb_items
     WHERE health_status != 'archived'
       AND (${whereParts.join(' OR ')})
     LIMIT ?`
  ).all(...params, limit) as { id: string; title: string; source_path: string }[];

  const result = new Map<string, number>();
  for (const row of rows) {
    if (allowedItemIds && !allowedItemIds.has(row.id)) continue;
    const titleCoverage = termCoverageScore(row.title || '', filtered).score;
    const pathCoverage = termCoverageScore(row.source_path || '', filtered).score;
    const boost = clamp(titleCoverage * 0.7 + pathCoverage * 0.3, 0, 1);
    if (boost > 0) result.set(row.id, boost);
  }
  return result;
}

function pickCandidateItemIds(
  summaryScores: Map<string, number>,
  bm25ItemScores: Map<string, number>,
  titlePathScores: Map<string, number>,
  limit: number,
): string[] {
  const summaryNorm = normalizeMap(summaryScores);
  const bm25Norm = normalizeMap(bm25ItemScores);
  const allItemIds = new Set<string>([
    ...summaryScores.keys(),
    ...bm25ItemScores.keys(),
    ...titlePathScores.keys(),
  ]);

  const ranked = Array.from(allItemIds).map((itemId) => {
    const score = summaryNorm.get(itemId) ?? 0;
    const bm = bm25Norm.get(itemId) ?? 0;
    const boost = titlePathScores.get(itemId) ?? 0;
    const fused = score * 0.45 + bm * 0.4 + boost * 0.15;
    return { itemId, score: fused };
  });
  ranked.sort((a, b) => b.score - a.score);

  return ranked.slice(0, limit).map((row) => row.itemId);
}

function fetchCandidateChunks(itemIds: string[]): ChunkMeta[] {
  if (!itemIds.length) return [];
  const db = getDb();
  const placeholders = itemIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT
      c.id AS chunk_id,
      c.item_id,
      c.content,
      c.chunk_index,
      c.embedding,
      i.title,
      i.source_path,
      i.source_type,
      i.summary,
      col.name AS collection_name
    FROM kb_chunks c
    JOIN kb_items i ON c.item_id = i.id
    JOIN kb_collections col ON i.collection_id = col.id
    WHERE c.item_id IN (${placeholders})
      AND i.health_status != 'archived'
    ORDER BY c.item_id ASC, c.chunk_index ASC`
  ).all(...itemIds) as Array<{
    chunk_id: string;
    item_id: string;
    content: string;
    chunk_index: number;
    embedding: Buffer | null;
    title: string;
    source_path: string;
    source_type: string;
    summary: string;
    collection_name: string;
  }>;

  return rows.map((row) => ({
    chunkId: row.chunk_id,
    itemId: row.item_id,
    content: row.content,
    chunkIndex: row.chunk_index,
    embedding: row.embedding,
    title: row.title,
    sourcePath: row.source_path,
    sourceType: row.source_type,
    summary: row.summary,
    collectionName: row.collection_name,
  }));
}

function selectChunksPerItem(
  chunks: ChunkMeta[],
  bm25ChunkScores: Map<string, number>,
  mode: 'reference' | 'enhanced',
): ChunkMeta[] {
  if (!chunks.length) return [];
  const grouped = new Map<string, ChunkMeta[]>();
  for (const chunk of chunks) {
    const list = grouped.get(chunk.itemId);
    if (list) list.push(chunk);
    else grouped.set(chunk.itemId, [chunk]);
  }

  const picked: ChunkMeta[] = [];
  const maxPerItem = mode === 'reference' ? 24 : 36;

  for (const itemChunks of grouped.values()) {
    const byIndex = new Map<number, ChunkMeta>();
    for (const chunk of itemChunks) byIndex.set(chunk.chunkIndex, chunk);

    const selected = new Map<string, ChunkMeta>();

    // Start with BM25 hits (+ adjacent chunks for continuity).
    for (const chunk of itemChunks) {
      if (!bm25ChunkScores.has(chunk.chunkId)) continue;
      selected.set(chunk.chunkId, chunk);
      const prev = byIndex.get(chunk.chunkIndex - 1);
      const next = byIndex.get(chunk.chunkIndex + 1);
      if (prev) selected.set(prev.chunkId, prev);
      if (next) selected.set(next.chunkId, next);
    }

    // Keep document opening chunks for context grounding.
    const headCount = Math.min(3, itemChunks.length);
    for (let i = 0; i < headCount; i += 1) {
      selected.set(itemChunks[i].chunkId, itemChunks[i]);
    }

    // Fill remaining quota evenly to avoid very long-document bias.
    if (selected.size < maxPerItem) {
      const stride = Math.max(1, Math.floor(itemChunks.length / maxPerItem));
      for (let i = 0; i < itemChunks.length && selected.size < maxPerItem; i += stride) {
        const chunk = itemChunks[i];
        selected.set(chunk.chunkId, chunk);
      }
      for (const chunk of itemChunks) {
        if (selected.size >= maxPerItem) break;
        selected.set(chunk.chunkId, chunk);
      }
    }

    picked.push(...selected.values());
  }

  return picked;
}

function scoreChunks(
  chunks: ChunkMeta[],
  queryEmbeddings: number[][],
  queryTerms: string[],
  bm25ChunkScores: Map<string, number>,
  summaryScores: Map<string, number>,
  titlePathScores: Map<string, number>,
  mode: 'reference' | 'enhanced',
): ScoredChunk[] {
  const bm25Norm = normalizeMap(bm25ChunkScores);
  const summaryNorm = normalizeMap(summaryScores);

  return chunks.map((chunk) => {
    let denseScore = 0;
    if (queryEmbeddings.length > 0 && chunk.embedding) {
      const chunkVec = bufferToVector(chunk.embedding);
      let best = -1;
      for (const queryVec of queryEmbeddings) {
        const score = cosineSimilarity(queryVec, chunkVec);
        if (score > best) best = score;
      }
      denseScore = normalizeScore(best);
    }

    const bm25Score = bm25Norm.get(chunk.chunkId) ?? 0;
    const summaryScore = summaryNorm.get(chunk.itemId) ?? 0;
    const titlePathScore = titlePathScores.get(chunk.itemId) ?? 0;
    const coverageScore = termCoverageScore(chunk.content.slice(0, 1000), queryTerms).score;

    const score = mode === 'reference'
      ? denseScore * 0.18 + bm25Score * 0.42 + summaryScore * 0.16 + titlePathScore * 0.14 + coverageScore * 0.1
      : denseScore * 0.42 + bm25Score * 0.24 + summaryScore * 0.18 + titlePathScore * 0.08 + coverageScore * 0.08;

    return {
      ...chunk,
      score: clamp(score, 0, 1),
      vectorScore: denseScore,
      bm25Score,
      summaryScore,
      titlePathScore,
      coverageScore,
    };
  });
}

function pickTopItemChunks(scored: ScoredChunk[], topK: number): ScoredChunk[] {
  if (!scored.length) return [];
  const byItem = new Map<string, ScoredChunk>();
  for (const chunk of scored) {
    const prev = byItem.get(chunk.itemId);
    if (!prev || chunk.score > prev.score) {
      byItem.set(chunk.itemId, chunk);
    }
  }

  return Array.from(byItem.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function buildSearchResults(
  scored: ScoredChunk[],
  retrievalMode: 'reference' | 'enhanced',
  queryTerms: string[],
): SearchResult[] {
  return scored.map((row) => {
    const summarySnippet = row.summary?.trim() || '';
    const contentSnippet = row.content?.trim() || '';
    const snippet = retrievalMode === 'reference'
      ? (summarySnippet || contentSnippet).slice(0, 220)
      : (contentSnippet || summarySnippet).slice(0, 1200);

    const matched = termCoverageScore(`${row.title}\n${row.sourcePath}\n${snippet}`, queryTerms).matched;
    return {
      item_id: row.itemId,
      kb_uri: `kb://item/${row.itemId}`,
      chunk_content: snippet,
      item_title: row.title,
      source_path: row.sourcePath,
      source_type: row.sourceType,
      score: Math.round(row.score * 10000) / 100,
      collection_name: row.collectionName,
      retrieval_mode: retrievalMode,
      match_terms: matched.length ? matched : undefined,
    };
  });
}

async function buildQueryPlans(
  queryVariants: string[],
  retrievalMode: 'reference' | 'enhanced',
): Promise<QueryPlan[]> {
  const plans: QueryPlan[] = [];
  const bm25TopK = retrievalMode === 'reference' ? 80 : 120;

  for (const text of queryVariants) {
    let embedding: number[] | null = null;
    try {
      embedding = await withTimeout(embedQuery(text), 10000);
    } catch {
      embedding = null;
    }

    const bm25Results = bm25.search(text, bm25TopK);
    plans.push({ embedding, bm25Results });
  }

  return plans;
}

/** Enhanced search: summary recall + candidate chunk rerank. */
export async function searchWithMeta(
  query: string,
  topKOrOpts: number | SearchOptions = 5,
): Promise<SearchRunOutput> {
  const opts: SearchOptions = typeof topKOrOpts === 'number'
    ? { topK: topKOrOpts }
    : topKOrOpts;
  const topK = clamp(Math.floor(opts.topK ?? 5), 1, 10);
  const retrievalMode = opts.retrievalMode || getDefaultRetrievalMode();
  const useSummarySearch = opts.useSummarySearch !== false;

  const timeFilter = opts.timeFilter ?? parseTimeFilter(query);
  const allowedIds = timeFilter ? getTimeFilteredItemIds(timeFilter) : undefined;

  let queryVariants: string[];
  if (opts.disableRewrite) {
    queryVariants = [query];
  } else {
    try {
      queryVariants = await withTimeout(rewriteQuery(query), 6000);
    } catch {
      queryVariants = [query];
    }
  }
  queryVariants = dedupeQueries(queryVariants);
  if (!queryVariants.length) queryVariants = [query];

  const plans = await buildQueryPlans(queryVariants, retrievalMode);
  const queryEmbeddings = plans
    .map((plan) => plan.embedding)
    .filter((embedding): embedding is number[] => Array.isArray(embedding));

  const allTerms = extractQueryTerms(queryVariants);
  const summaryItemScores = new Map<string, number>();
  const bm25ChunkScores = new Map<string, number>();
  const bm25ItemScores = new Map<string, number>();
  const summaryEmbeddings = useSummarySearch
    ? loadSummaryEmbeddings(allowedIds)
    : [];

  const summaryTopK = retrievalMode === 'reference' ? 24 : 36;
  for (const plan of plans) {
    if (useSummarySearch && plan.embedding && summaryEmbeddings.length > 0) {
      const summaryHits = summarySearchItems(plan.embedding, summaryEmbeddings, summaryTopK);
      for (const hit of summaryHits) {
        mergeMax(summaryItemScores, hit.itemId, hit.score);
      }
    }

    for (const hit of plan.bm25Results) {
      mergeMax(bm25ChunkScores, hit.chunkId, hit.score);
    }
  }

  const chunkItemMap = lookupChunkItemMap(Array.from(bm25ChunkScores.keys()));
  for (const [chunkId, score] of bm25ChunkScores.entries()) {
    const itemId = chunkItemMap.get(chunkId);
    if (!itemId) continue;
    if (allowedIds && !allowedIds.has(itemId)) continue;
    mergeMax(bm25ItemScores, itemId, score);
  }

  const titlePathScores = searchTitlePathCandidates(
    allTerms,
    retrievalMode === 'reference' ? 80 : 120,
    allowedIds,
  );

  const candidatePool = getCandidatePoolSize(retrievalMode, topK);
  const candidateItemIds = pickCandidateItemIds(
    summaryItemScores,
    bm25ItemScores,
    titlePathScores,
    candidatePool,
  );

  if (!candidateItemIds.length) {
    return {
      results: [],
      meta: {
        queryVariants,
        retrievalMode,
        timeFilter: timeFilter || null,
        candidateItems: 0,
        candidateChunks: 0,
      },
    };
  }

  const rawChunks = fetchCandidateChunks(candidateItemIds);
  const candidateChunks = selectChunksPerItem(rawChunks, bm25ChunkScores, retrievalMode);
  const scored = scoreChunks(
    candidateChunks,
    queryEmbeddings,
    allTerms,
    bm25ChunkScores,
    summaryItemScores,
    titlePathScores,
    retrievalMode,
  );
  const topItemChunks = pickTopItemChunks(scored, topK);
  const results = buildSearchResults(topItemChunks, retrievalMode, allTerms);

  return {
    results,
    meta: {
      queryVariants,
      retrievalMode,
      timeFilter: timeFilter || null,
      candidateItems: candidateItemIds.length,
      candidateChunks: candidateChunks.length,
    },
  };
}

/** Backward-compatible search entry (returns only results). */
export async function searchAll(
  query: string,
  topKOrOpts: number | SearchOptions = 5,
): Promise<SearchResult[]> {
  const run = await searchWithMeta(query, topKOrOpts);
  return run.results;
}

/** Format results as context for AI prompt */
export function buildContext(
  results: SearchResult[],
  options?: {
    retrievalMode?: 'reference' | 'enhanced';
    queryVariants?: string[];
  },
): string {
  if (!results.length) return '';
  const mode = options?.retrievalMode || results[0]?.retrieval_mode || 'reference';
  const queryVariantLine = options?.queryVariants?.length
    ? `查询扩展: ${options.queryVariants.join(' | ')}`
    : '';

  if (mode === 'reference') {
    const lines = results.map((r, i) =>
      `${i + 1}. 《${r.item_title}》 (相关度 ${r.score}%)\n`
      + `   kb_uri: ${r.kb_uri}\n`
      + `   source: ${r.source_path || r.source_type}\n`
      + `   摘要: ${r.chunk_content}`
    );
    return [
      '[知识库命中 - 路径优先模式]',
      queryVariantLine,
      '说明: 优先根据 source 路径做二次读取与分析；摘要仅用于快速定位。',
      ...lines,
    ].filter(Boolean).join('\n');
  }

  const lines = results.map((r, i) =>
    `${i + 1}. 《${r.item_title}》(相关度: ${r.score}%)\n`
    + `   kb_uri: ${r.kb_uri}\n`
    + `   来源: ${r.source_path || r.source_type}\n`
    + `   片段: ${r.chunk_content.slice(0, 260)}`
  );
  return [
    '[知识库命中 - 增强模式]',
    queryVariantLine,
    ...lines,
  ].filter(Boolean).join('\n');
}
