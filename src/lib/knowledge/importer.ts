/**
 * Import pipeline — parse → store → chunk → BM25 → embed → summarize
 * Enhanced: auto-tag + auto-summarize + summary embedding on import
 */
import * as store from './store';
import { splitText } from './chunker';
import { indexItem } from './embedder';
import { indexItemChunks } from './bm25';
import { autoTagCategorized } from './tagger';
import { summarizeAndEmbed } from './summarizer';
import type { KbStageStatus, KbProcessingStatus, CategorizedTag } from './types';
import { buildTagCandidates, syncItemTagSystem } from './tag-system';

interface ImportData {
  title: string;
  source_type: 'local_file' | 'feishu' | 'manual' | 'webpage' | 'local_dir';
  source_path?: string;
  source_key?: string;
  tags?: string[];
}

interface ImportPipelineOptions {
  mode?: 'full' | 'reference';
  parseError?: string;
}

interface ProcessingDetail {
  mode: 'full' | 'reference';
  parse: KbStageStatus;
  chunk: KbStageStatus;
  bm25: KbStageStatus;
  embedding: KbStageStatus;
  summary: KbStageStatus;
}

function detailToJson(detail: ProcessingDetail): string {
  return JSON.stringify(detail);
}

function createDetail(mode: 'full' | 'reference', parseStatus: KbStageStatus): ProcessingDetail {
  const isReference = mode === 'reference';
  return {
    mode,
    parse: parseStatus,
    chunk: 'pending',
    bm25: 'pending',
    embedding: isReference ? 'skipped' : 'pending',
    summary: isReference ? 'skipped' : 'pending',
  };
}

function resolveStatus(detail: ProcessingDetail, hasError: boolean): KbProcessingStatus {
  if (detail.mode === 'reference') {
    if (detail.chunk === 'failed' || detail.bm25 === 'failed') return 'partial';
    return 'reference_only';
  }
  const hardFailed = detail.parse === 'failed' || detail.chunk === 'failed' || detail.bm25 === 'failed';
  if (hardFailed) return 'failed';
  if (detail.summary === 'running') return 'summarizing';
  if (detail.embedding === 'running') return 'embedding';
  if (detail.bm25 === 'running') return 'indexing';
  if (detail.chunk === 'running') return 'chunking';
  if (detail.parse === 'running') return 'parsing';
  const stageValues = [detail.parse, detail.chunk, detail.bm25, detail.embedding, detail.summary];
  if (stageValues.every((value) => value === 'done' || value === 'skipped')) return 'ready';
  if (detail.embedding === 'failed') return 'partial';
  if (detail.summary === 'failed') return 'ready';
  if (hasError) return 'partial';
  return 'pending';
}

function stageFailed(detail: ProcessingDetail): boolean {
  return [detail.parse, detail.chunk, detail.bm25, detail.embedding, detail.summary].includes('failed');
}

/** Core import flow: store item → chunk → BM25 → embed → tag */
export async function processImport(
  collectionId: string,
  data: ImportData,
  fullContent: string,
  options?: ImportPipelineOptions,
) {
  const mode = options?.mode || 'full';
  const parseError = (options?.parseError || '').trim();
  const parseStatus: KbStageStatus = parseError ? 'failed' : 'done';
  const detail = createDetail(mode, parseStatus);
  const hasParseError = Boolean(parseError);

  // 1. Auto-tag
  let categorizedTags: CategorizedTag[] = [];
  try {
    const existingTags = data.tags || [];
    const { matched, suggested } = await autoTagCategorized(fullContent, existingTags);
    categorizedTags = [...matched, ...suggested];
    data.tags = Array.from(
      new Set([
        ...existingTags,
        ...categorizedTags.map((tag) => tag.name),
      ]),
    );
  } catch { /* skip */ }

  // 2. Store item
  const item = store.addItem(collectionId, {
    title: data.title,
    source_type: data.source_type,
    source_path: data.source_path,
    source_key: data.source_key,
    content: fullContent.length <= 2000 ? fullContent : '',
    tags: data.tags,
    processing_status: hasParseError ? 'partial' : 'pending',
    processing_detail: detailToJson(detail),
    processing_error: parseError,
  });

  // 2.1 Keep a structured tag taxonomy in sync with item tags.
  try {
    const candidates = buildTagCandidates(data.tags || [], categorizedTags);
    syncItemTagSystem(item.id, candidates);
  } catch (error) {
    console.error('[kb] Tag system sync failed:', (error as Error).message);
  }

  const persist = (patch: {
    status?: KbProcessingStatus;
    error?: string;
    chunkCount?: number;
  }) => {
    const finalStatus = patch.status || resolveStatus(detail, stageFailed(detail));
    store.updateItemProcessing(item.id, {
      status: finalStatus,
      detail: detailToJson(detail),
      error: patch.error,
      chunkCount: patch.chunkCount,
    });
  };

  if (mode === 'reference') {
    // Reference-only sources still get one chunk for lexical retrieval by title/path.
    const fallbackText = fullContent.trim() || `[Reference] ${data.title}\n${data.source_path || ''}`;
    detail.chunk = 'running';
    persist({});
    store.saveChunks(item.id, [fallbackText]);
    detail.chunk = 'done';

    detail.bm25 = 'running';
    persist({ chunkCount: 1 });
    try {
      indexItemChunks(item.id, [fallbackText], data.title);
      detail.bm25 = 'done';
    } catch {
      detail.bm25 = 'failed';
    }

    persist({
      status: resolveStatus(detail, stageFailed(detail)),
      chunkCount: 1,
      error: parseError,
    });
    return { item: store.getItem(item.id) || item, chunkCount: 1 };
  }

  // 3. Chunk
  detail.chunk = 'running';
  persist({});
  const chunks = splitText(fullContent);
  if (!chunks.length || !chunks.some((chunk) => chunk.trim())) {
    detail.chunk = 'failed';
    persist({ status: 'failed', error: parseError || 'empty_chunks' });
    throw new Error('No valid chunks generated');
  }
  detail.chunk = 'done';

  // 4. Save chunks to DB
  store.saveChunks(item.id, chunks);
  persist({ chunkCount: chunks.length });

  // 5. BM25 index
  detail.bm25 = 'running';
  persist({});
  try {
    indexItemChunks(item.id, chunks, data.title);
    detail.bm25 = 'done';
  } catch {
    detail.bm25 = 'failed';
  }
  persist({});

  // 6. Vector embed (async, non-blocking failure)
  detail.embedding = 'running';
  persist({});
  try {
    await indexItem(item.id, chunks);
    detail.embedding = 'done';
  } catch (err) {
    console.error(`[kb] Embedding failed for ${item.id}:`, (err as Error).message);
    detail.embedding = 'failed';
  }
  persist({});

  // 7. Auto-summarize + summary embedding
  detail.summary = 'running';
  persist({});
  try {
    const summary = await summarizeAndEmbed(item.id);
    detail.summary = summary ? 'done' : 'failed';
  } catch (err) {
    detail.summary = 'failed';
    console.error(`[kb] Summarize failed for ${item.id}:`, (err as Error).message);
  }
  persist({
    status: resolveStatus(detail, stageFailed(detail)),
    error: parseError,
    chunkCount: chunks.length,
  });

  return {
    item: store.getItem(item.id) || item,
    chunkCount: chunks.length,
  };
}

/** Import plain text */
export async function importText(
  collectionId: string,
  title: string,
  content: string,
  tags: string[] = [],
) {
  if (!content?.trim()) throw new Error('内容为空');
  return processImport(collectionId, {
    title: title || '手动录入',
    source_type: 'manual',
    tags,
  }, content);
}

/** Import from a URL (content provided by caller) */
export async function importWebPage(
  collectionId: string,
  title: string,
  url: string,
  content: string,
  sourceKey?: string,
) {
  if (!content?.trim()) throw new Error('网页内容为空');
  return processImport(collectionId, {
    title: title || '网页',
    source_type: 'webpage',
    source_path: url,
    source_key: sourceKey,
  }, content);
}
