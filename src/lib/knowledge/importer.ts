/**
 * Import pipeline — parse → store → chunk → BM25 → embed → summarize
 * Enhanced: auto-tag + auto-summarize + summary embedding on import
 */
import * as store from './store';
import { splitText } from './chunker';
import { indexItem } from './embedder';
import { indexItemChunks } from './bm25';
import { autoTag } from './tagger';
import { summarizeAndEmbed } from './summarizer';

interface ImportData {
  title: string;
  source_type: 'local_file' | 'feishu' | 'manual' | 'webpage';
  source_path?: string;
  tags?: string[];
}

/** Core import flow: store item → chunk → BM25 → embed → tag */
export async function processImport(
  collectionId: string,
  data: ImportData,
  fullContent: string,
) {
  // 1. Auto-tag
  try {
    const { matched, suggested } = await autoTag(fullContent);
    data.tags = [...new Set([...(data.tags || []), ...matched, ...suggested])];
  } catch { /* skip */ }

  // 2. Store item
  const item = store.addItem(collectionId, {
    title: data.title,
    source_type: data.source_type,
    source_path: data.source_path,
    content: fullContent.length <= 2000 ? fullContent : '',
    tags: data.tags,
  });

  // 3. Chunk
  const chunks = splitText(fullContent);

  // 4. Save chunks to DB
  store.saveChunks(item.id, chunks);

  // 5. BM25 index
  indexItemChunks(item.id, chunks, data.title);

  // 6. Vector embed (async, non-blocking failure)
  try {
    await indexItem(item.id, chunks);
  } catch (err) {
    console.error(`[kb] Embedding failed for ${item.id}:`, (err as Error).message);
  }

  // 7. Auto-summarize + summary embedding (async, non-blocking)
  summarizeAndEmbed(item.id).catch(err => {
    console.error(`[kb] Summarize failed for ${item.id}:`, (err as Error).message);
  });

  return { item, chunkCount: chunks.length };
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
) {
  if (!content?.trim()) throw new Error('网页内容为空');
  return processImport(collectionId, {
    title: title || '网页',
    source_type: 'webpage',
    source_path: url,
  }, content);
}
