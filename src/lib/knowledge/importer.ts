/**
 * Import pipeline — parse → store → chunk → BM25 → embed → summarize
 * Enhanced: auto-tag + auto-summarize + summary embedding on import
 */
import * as store from './store';
import { splitText } from './chunker';
import { indexItem } from './embedder';
import { indexItemChunks } from './bm25';
import { autoTagCategorizedStrict } from './tagger';
import { summarizeAndEmbedStrict } from './summarizer';
import { isKnowledgeEnhancementUnavailableError } from './llm';
import type { KbStageStatus, KbProcessingStatus, CategorizedTag } from './types';
import { buildTagCandidates, syncItemTagSystem } from './tag-system';
import {
  createDetail,
  detailToJson,
  resolveStatus,
  stageFailed,
} from './processing-status';
import {
  appendProcessingError,
  appendProcessingMessage,
  buildStoredPreviewContent,
} from './pipeline-support';

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
  let processingError = appendProcessingMessage('', '解析', parseError);

  // 1. Auto-tag
  let categorizedTags: CategorizedTag[] = [];
  try {
    const existingTags = data.tags || [];
    const { matched, suggested } = await autoTagCategorizedStrict(fullContent, existingTags);
    categorizedTags = [...matched, ...suggested];
    data.tags = Array.from(
      new Set([
        ...existingTags,
        ...categorizedTags.map((tag) => tag.name),
      ]),
    );
  } catch (error) {
    if (!isKnowledgeEnhancementUnavailableError(error)) {
      processingError = appendProcessingError(processingError, '标签', error, 'tag_generation_failed');
    }
  }

  // 2. Store item
  const item = store.addItem(collectionId, {
    title: data.title,
    source_type: data.source_type,
    source_path: data.source_path,
    source_key: data.source_key,
    content: buildStoredPreviewContent(fullContent),
    tags: data.tags,
    processing_status: hasParseError ? 'partial' : 'pending',
    processing_detail: detailToJson(detail),
    processing_error: processingError,
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
      error: patch.error ?? processingError,
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
    } catch (error) {
      detail.bm25 = 'failed';
      processingError = appendProcessingError(
        processingError,
        '检索索引',
        error,
        'bm25_index_failed',
      );
    }

    persist({
      status: resolveStatus(detail, stageFailed(detail)),
      chunkCount: 1,
      error: processingError,
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
  } catch (error) {
    detail.bm25 = 'failed';
    processingError = appendProcessingError(
      processingError,
      '检索索引',
      error,
      'bm25_index_failed',
    );
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
    processingError = appendProcessingError(
      processingError,
      '向量化',
      err,
      'embedding_failed',
    );
  }
  persist({});

  // 7. Auto-summarize + summary embedding
  detail.summary = 'running';
  persist({});
  try {
    const summary = await summarizeAndEmbedStrict(item.id);
    if (summary) {
      detail.summary = 'done';
    } else {
      detail.summary = 'failed';
      processingError = appendProcessingMessage(processingError, '摘要', '模型返回空内容，请检查服务商配置和模型是否可用');
    }
  } catch (err) {
    if (isKnowledgeEnhancementUnavailableError(err)) {
      detail.summary = 'skipped';
    } else {
      detail.summary = 'failed';
      console.error(`[kb] Summarize failed for ${item.id}:`, (err as Error).message);
      processingError = appendProcessingError(
        processingError,
        '摘要',
        err,
        'summary_failed',
      );
    }
  }
  persist({
    status: resolveStatus(detail, stageFailed(detail)),
    error: processingError,
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
