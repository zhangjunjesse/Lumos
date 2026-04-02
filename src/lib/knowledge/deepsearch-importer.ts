/**
 * DeepSearch → Knowledge Library auto-archive
 *
 * Archives completed DeepSearch run records into the "联网搜索资料" collection.
 * Idempotent: existing URLs are skipped via source_key dedup within the collection.
 */
import fs from 'node:fs/promises';
import { getDeepSearchRun, updateDeepSearchRunArchivedAt } from '@/lib/db';
import * as store from './store';
import { processImport } from './importer';
import type { DeepSearchArtifactRecord, DeepSearchRecord } from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLLECTION_NAME = '联网搜索资料';
const COLLECTION_DESC = '由 DeepSearch 自动归档的网页内容，来自知乎、微信公众号、小红书、掘金等';

const SITE_KEY_LABELS: Record<string, string> = {
  zhihu: '知乎',
  wechat: '微信公众号',
  xiaohongshu: '小红书',
  juejin: '掘金',
  x: 'Twitter',
};

const STOP_WORDS = new Set([
  '的', '是', '在', '了', '和', '与', '或', '等', '来自', '关于',
  '怎么', '什么', '如何', '哪些', '一些', '这些', '那些',
  '知乎', '微信', '小红书', '掘金', 'twitter',
]);

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ArchiveResult {
  runId: string;
  total: number;
  eligible: number;
  saved: number;
  duplicate: number;
  failed: number;
  skipped: number;
  collectionId: string;
  collectionName: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Archive all completed records of a DeepSearch run to the knowledge library.
 * Idempotent: runs with archivedAt set are short-circuited.
 */
export async function archiveDeepSearchRun(runId: string): Promise<ArchiveResult> {
  const run = getDeepSearchRun(runId);
  if (!run) throw new Error(`DeepSearch run not found: ${runId}`);

  // Run-level short circuit: already archived
  if (run.archivedAt) {
    const col = ensureArchiveCollection();
    return {
      runId, total: run.records.length, eligible: 0,
      saved: 0, duplicate: 0, failed: 0, skipped: run.records.length,
      collectionId: col, collectionName: COLLECTION_NAME,
    };
  }

  const collectionId = ensureArchiveCollection();
  const result: ArchiveResult = {
    runId, total: run.records.length, eligible: 0,
    saved: 0, duplicate: 0, failed: 0,
    skipped: 0, collectionId, collectionName: COLLECTION_NAME,
  };

  for (const record of run.records) {
    // Only archive records with actual content
    if (record.contentState === 'list_only' || record.contentState === 'failed' || !record.url) {
      result.skipped++;
      continue;
    }

    const content = await resolveContent(record);
    if (!content) {
      result.skipped++;
      continue;
    }

    result.eligible++;
    const sourceKey = buildSourceKey(record.url);

    // Dedup within collection
    if (store.findItemBySourceKey(collectionId, sourceKey)) {
      result.duplicate++;
      continue;
    }

    try {
      const tags = buildTags(record.siteKey, run.queryText);
      const title = record.title || record.url;

      // Use the full import pipeline: BM25 + embedding + auto-summary + auto-tag
      const { item } = await processImport(
        collectionId,
        {
          title,
          source_type: 'webpage',
          source_path: record.url,
          source_key: sourceKey,
          tags,
        },
        content,
      );

      // Set doc_date from fetchedAt (non-critical)
      const docDate = record.fetchedAt?.slice(0, 10);
      if (docDate) {
        try {
          const { getDb } = await import('@/lib/db');
          getDb()
            .prepare('UPDATE kb_items SET doc_date = ? WHERE id = ?')
            .run(docDate, item.id);
        } catch {
          // doc_date column may not exist in older schemas
        }
      }

      result.saved++;
    } catch (err) {
      console.error(`[deepsearch-importer] Failed to import ${record.url}:`, (err as Error).message);
      result.failed++;
    }
  }

  // Mark run as archived
  if (result.saved > 0 || result.duplicate > 0) {
    updateDeepSearchRunArchivedAt(runId);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureArchiveCollection(): string {
  const existing = store.listCollections().find(c => c.name === COLLECTION_NAME);
  if (existing) return existing.id;
  const col = store.createCollection(COLLECTION_NAME, COLLECTION_DESC);
  return col.id;
}

function buildSourceKey(url: string): string {
  return `deepsearch:${url}`;
}

function buildTags(siteKey: string | null, queryText: string): string[] {
  const fixed = ['deepsearch', '联网搜索'];
  const site = siteKey ? [SITE_KEY_LABELS[siteKey] ?? siteKey] : [];
  const query = extractQueryTags(queryText);
  return [...new Set([...fixed, ...site, ...query])];
}

function extractQueryTags(queryText: string): string[] {
  if (!queryText?.trim()) return [];
  const words = queryText.split(/[\s，,。.、！!？?；;：:]+/);
  return words
    .map(w => w.trim())
    .filter(w => w.length > 1 && !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 3);
}

async function resolveContent(record: DeepSearchRecord): Promise<string | null> {
  // Try artifact full text first
  const artifact = record.contentArtifact as DeepSearchArtifactRecord | null;
  if (artifact?.storagePath) {
    try {
      const text = await fs.readFile(artifact.storagePath, 'utf-8');
      if (text.trim()) return text;
    } catch {
      // File deleted or unreadable, fall through to snippet
    }
  }

  // Fallback: snippet + title
  const snippet = record.snippet?.trim();
  if (snippet) {
    return record.title ? `${record.title}\n\n${snippet}` : snippet;
  }

  return null;
}
