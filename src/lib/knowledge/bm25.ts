/**
 * BM25 keyword search — Chinese tokenization + inverted index in SQLite
 * Ported from demo/local-server/services/knowledge/bm25.js
 */
import { Jieba } from '@node-rs/jieba';
import { dict as jiebaDict } from '@node-rs/jieba/dict';
import { getDb } from '@/lib/db';

const K1 = 1.2;
const B = 0.75;

const STOPWORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一',
  '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着',
  '没有', '看', '好', '自己', '这', '他', '她', '它', '们', '那', '些',
  '什么', '怎么', '如何', '哪些', '可以', '能', '吗', '呢', '吧', '啊',
  '把', '被', '让', '给', '从', '向', '对', '与', '及', '等', '而',
  '但', '却', '又', '或', '如果', '因为', '所以', '虽然', '但是',
  '这个', '那个', '这些', '那些', '之', '其', '中', '为', '以',
]);

let _jieba: { cutForSearch(text: string): string[] } | null = null;
let _indexRevision = 0;
let _statsCache: {
  revision: number;
  totalDocs: number;
  avgdl: number;
  dlMap: Record<string, number>;
} | null = null;

function getJieba() {
  if (!_jieba) {
    _jieba = Jieba.withDict(jiebaDict);
  }
  return _jieba!;
}

function invalidateStatsCache() {
  _indexRevision += 1;
  _statsCache = null;
}

/** Tokenize + remove stopwords */
export function tokenize(text: string): string[] {
  return getJieba().cutForSearch(text)
    .filter((w: string) => w.trim().length > 0 && !STOPWORDS.has(w));
}

/** Add a chunk's terms to the BM25 inverted index */
export function addToIndex(
  chunkId: string,
  text: string,
  options?: { skipInvalidate?: boolean },
) {
  const db = getDb();
  const tokens = tokenize(text);
  if (!tokens.length) return;
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  const total = tokens.length || 1;

  const stmt = db.prepare(
    'INSERT OR REPLACE INTO kb_bm25_index (term, chunk_id, tf) VALUES (?,?,?)'
  );
  const txn = db.transaction(() => {
    for (const [term, count] of Object.entries(tf)) {
      stmt.run(term, chunkId, count / total);
    }
  });
  txn();
  if (!options?.skipInvalidate) invalidateStatsCache();
}

/** Remove a chunk from the index */
export function removeFromIndex(chunkId: string) {
  getDb().prepare('DELETE FROM kb_bm25_index WHERE chunk_id=?').run(chunkId);
  invalidateStatsCache();
}

/** Remove all index entries for an item's chunks */
export function removeItemFromIndex(itemId: string) {
  getDb().prepare(
    'DELETE FROM kb_bm25_index WHERE chunk_id IN (SELECT id FROM kb_chunks WHERE item_id=?)'
  ).run(itemId);
  invalidateStatsCache();
}

function getCorpusStats(): {
  totalDocs: number;
  avgdl: number;
  dlMap: Record<string, number>;
} {
  if (_statsCache && _statsCache.revision === _indexRevision) {
    return _statsCache;
  }

  const db = getDb();
  const totalDocs = (db.prepare(
    'SELECT COUNT(DISTINCT chunk_id) as c FROM kb_bm25_index'
  ).get() as { c: number }).c;

  const dlRows = db.prepare(
    'SELECT chunk_id, COUNT(*) as dl FROM kb_bm25_index GROUP BY chunk_id'
  ).all() as { chunk_id: string; dl: number }[];
  const dlMap: Record<string, number> = {};
  let totalTerms = 0;
  for (const row of dlRows) {
    dlMap[row.chunk_id] = row.dl;
    totalTerms += row.dl;
  }

  const cache = {
    revision: _indexRevision,
    totalDocs,
    avgdl: totalTerms / Math.max(dlRows.length, 1),
    dlMap,
  };
  _statsCache = cache;
  return cache;
}

/** BM25 search across all indexed chunks */
export function search(query: string, topK = 20): { chunkId: string; score: number }[] {
  const db = getDb();
  const queryTokens = Array.from(new Set(tokenize(query)));
  if (!queryTokens.length) return [];

  const { totalDocs, avgdl, dlMap } = getCorpusStats();
  if (!totalDocs) return [];

  const placeholders = queryTokens.map(() => '?').join(',');
  const postings = db.prepare(
    `SELECT term, chunk_id, tf FROM kb_bm25_index WHERE term IN (${placeholders})`
  ).all(...queryTokens) as { term: string; chunk_id: string; tf: number }[];
  if (!postings.length) return [];

  const dfMap = new Map<string, number>();
  for (const row of postings) {
    dfMap.set(row.term, (dfMap.get(row.term) || 0) + 1);
  }

  const scores: Record<string, number> = {};
  for (const row of postings) {
    const df = dfMap.get(row.term) || 0;
    if (!df) continue;
    const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
    const dl = dlMap[row.chunk_id] || avgdl;
    const tfScore = (row.tf * (K1 + 1)) / (row.tf + K1 * (1 - B + B * dl / Math.max(avgdl, 1e-6)));
    scores[row.chunk_id] = (scores[row.chunk_id] || 0) + idf * tfScore;
  }

  return Object.entries(scores)
    .map(([chunkId, score]) => ({ chunkId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/** Index all chunks for an item */
export function indexItemChunks(itemId: string, chunks: string[], title: string) {
  const db = getDb();
  const chunkRows = db.prepare(
    'SELECT id, chunk_index FROM kb_chunks WHERE item_id=? ORDER BY chunk_index'
  ).all(itemId) as { id: string; chunk_index: number }[];

  for (const row of chunkRows) {
    const text = row.chunk_index === 0 && title
      ? `${title}\n${chunks[row.chunk_index]}`
      : chunks[row.chunk_index];
    if (text) addToIndex(row.id, text, { skipInvalidate: true });
  }
  invalidateStatsCache();
}
