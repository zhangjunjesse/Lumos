import {
  COLLECTION_LIBRARY_LINKS,
  COLLECTION_TRANSCRIPTS,
  COLLECTION_VIDEOS,
} from './constants';
import { indexItemChunks } from '@/lib/knowledge/bm25';
import { splitText } from '@/lib/knowledge/chunker';
import { indexItem } from '@/lib/knowledge/embedder';
import { isKnowledgeEnhancementUnavailableError } from '@/lib/knowledge/llm';
import {
  appendProcessingError,
  appendProcessingMessage,
} from '@/lib/knowledge/pipeline-support';
import {
  createDetail,
  detailToJson,
  resolveStatus,
  stageFailed,
} from '@/lib/knowledge/processing-status';
import { clearSummaryArtifacts, summarizeAndEmbedStrict } from '@/lib/knowledge/summarizer';
import { autoTagCategorizedStrict } from '@/lib/knowledge/tagger';
import { buildTagCandidates, syncItemTagSystem } from '@/lib/knowledge/tag-system';
import type { CategorizedTag } from '@/lib/knowledge/types';
import { parseTranscriptText, parseVideoChapters, parseVideoTags } from './parsers';
import { getDouyinCollectorStore } from './storage';

interface VideoForPublish {
  aweme_id?: string;
  creator_nickname?: string | null;
  title?: string | null;
  duration_seconds?: number;
  duration_bucket?: string;
  language?: string;
  subtitle_source?: string;
  summary?: string | null;
  tags?: string | null;
  chapters?: string | null;
  notes?: string | null;
  library_status?: string;
}

interface TranscriptForPublish {
  source?: string;
  segments?: string;
  word_count?: number;
}

export type PublishOutcome =
  | { ok: true; itemId: string; collectionId: string }
  | { ok: false; reason: string };

/**
 * Push a collected douyin video into a knowledge-base collection.
 *
 * Idempotent on `(collection, aweme_id)` via knowledge `source_key`. Calling
 * it twice for the same video produces a single kb item; the second call
 * updates a `library_links` record but does not duplicate.
 *
 * Honest contract: requires the caller to know the target `collectionId`
 * (usually `settings.libraryCollectionId`). Returns structured failure when
 * the video has no transcript yet — never write empty content.
 */
export async function publishVideoToKnowledge(
  videoId: string,
  collectionId: string,
): Promise<PublishOutcome> {
  if (!collectionId) {
    return { ok: false, reason: '未指定目标 knowledge collection。' };
  }

  const store = getDouyinCollectorStore();
  const video = store.get<VideoForPublish>(COLLECTION_VIDEOS, videoId);
  if (!video) return { ok: false, reason: '视频记录不存在。' };

  const transcripts = store.query<TranscriptForPublish>(COLLECTION_TRANSCRIPTS, {
    filter: { video_ref: videoId },
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 1,
  });
  const transcript = transcripts[0];
  if (!transcript || !transcript.segments) {
    return {
      ok: false,
      reason: '该视频还没有 transcript；请先「抓字幕」再入库，避免写入空内容。',
    };
  }

  const transcriptText = parseTranscriptText(transcript.segments).trim();
  if (!transcriptText) {
    return {
      ok: false,
      reason: 'transcript 内容为空，拒绝写入知识库。',
    };
  }

  const tags = parseVideoTags(video.tags);
  const chapters = parseVideoChapters(video.chapters);
  const summary = video.summary?.trim() || '';
  const title =
    video.title ?? `抖音视频 ${(video.aweme_id ?? videoId).slice(0, 12)}`;
  const author = video.creator_nickname ?? '未知博主';
  const subtitleSource = video.subtitle_source ?? 'unknown';
  // Round 177: include chapters as a navigable section so the kb_item
  // is more than a wall of transcript text. Round 174 makes startSec
  // grounded in real timestamps; surfacing chapters here gives the
  // user a 30-second skim outline for any 30-min video they curated.
  const chaptersBlock = chapters.length > 0
    ? `## 章节\n${chapters
        .map((c) => {
          const m = Math.floor(c.startSec / 60);
          const s = Math.floor(c.startSec % 60).toString().padStart(2, '0');
          return `- [${m}:${s}] ${c.title}`;
        })
        .join('\n')}\n\n`
    : '';
  const content =
    `# ${title}\n` +
    `作者：${author}\n` +
    `时长：${video.duration_seconds ?? '?'} 秒（${video.duration_bucket ?? ''}）\n` +
    `字幕来源：${subtitleSource}\n\n` +
    (summary ? `## 摘要\n${summary}\n\n` : '') +
    chaptersBlock +
    `## 字幕原文\n${transcriptText}\n` +
    (video.notes ? `\n## 备注\n${video.notes}\n` : '');

  const sourceKey = `douyin:${video.aweme_id ?? videoId}`;
  const knowledge = await import('@/lib/knowledge/store');
  const existing = knowledge.findItemBySourceKey(collectionId, sourceKey);
  let itemId: string;
  if (existing) {
    // KbItem.tags is a JSON-array string per knowledge/types.ts; serialize.
    knowledge.patchItem(existing.id, {
      title,
      source_type: 'manual',
      source_path: video.aweme_id ? `https://www.douyin.com/video/${video.aweme_id}` : '',
      tags: JSON.stringify(tags),
      content,
    });
    itemId = existing.id;
  } else {
    const created = knowledge.addItem(collectionId, {
      title,
      source_type: 'manual',
      source_path: video.aweme_id ? `https://www.douyin.com/video/${video.aweme_id}` : '',
      source_key: sourceKey,
      content,
      tags,
    });
    itemId = created.id;
  }
  await indexKnowledgeTextItem(itemId, title, content, tags);

  const now = new Date().toISOString();
  const existingLink = store
    .query<{ collection_id?: string; video_ref?: string }>(COLLECTION_LIBRARY_LINKS, {
      filter: { video_ref: videoId, collection_id: collectionId },
      limit: 1,
    })
    .at(0);
  if (existingLink) {
    store.update(COLLECTION_LIBRARY_LINKS, existingLink.id, {
      chunk_id: itemId,
      pushed_at: now,
      updated_at: now,
    });
  } else {
    store.create(COLLECTION_LIBRARY_LINKS, {
      video_ref: videoId,
      collection_id: collectionId,
      chunk_id: itemId,
      pushed_at: now,
      version: 1,
      updated_at: now,
    });
  }

  store.update(COLLECTION_VIDEOS, videoId, {
    library_status: 'published',
    library_collection_id: collectionId,
    failure_reason: null,
    updated_at: now,
  });

  return { ok: true, itemId, collectionId };
}

async function indexKnowledgeTextItem(
  itemId: string,
  title: string,
  content: string,
  originalTags: string[],
): Promise<void> {
  const knowledge = await import('@/lib/knowledge/store');
  const detail = createDetail('full', 'done');
  let processingError = '';
  const persist = (chunkCount?: number) => {
    knowledge.updateItemProcessing(itemId, {
      status: resolveStatus(detail, stageFailed(detail)),
      detail: detailToJson(detail),
      error: processingError,
      ...(typeof chunkCount === 'number' ? { chunkCount } : {}),
    });
  };

  clearSummaryArtifacts(itemId);

  detail.chunk = 'running';
  persist();
  const chunks = splitText(content).filter((chunk) => chunk.trim().length > 0);
  if (chunks.length === 0) {
    detail.chunk = 'failed';
    processingError = appendProcessingMessage(processingError, '切分', 'empty_chunks');
    persist(0);
    return;
  }
  knowledge.saveChunks(itemId, chunks);
  detail.chunk = 'done';
  persist(chunks.length);

  detail.bm25 = 'running';
  persist(chunks.length);
  try {
    indexItemChunks(itemId, chunks, title);
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
  persist(chunks.length);

  detail.embedding = 'running';
  persist(chunks.length);
  try {
    await indexItem(itemId, chunks);
    detail.embedding = 'done';
  } catch (error) {
    detail.embedding = 'failed';
    processingError = appendProcessingError(
      processingError,
      '向量化',
      error,
      'embedding_failed',
    );
  }

  detail.summary = 'running';
  persist(chunks.length);
  try {
    const summary = await summarizeAndEmbedStrict(itemId);
    if (summary) {
      detail.summary = 'done';
    } else {
      detail.summary = 'failed';
      processingError = appendProcessingMessage(
        processingError,
        '摘要',
        '模型返回空内容，请检查服务商配置和模型是否可用',
      );
    }
  } catch (error) {
    if (isKnowledgeEnhancementUnavailableError(error)) {
      detail.summary = 'skipped';
    } else {
      detail.summary = 'failed';
      processingError = appendProcessingError(
        processingError,
        '摘要',
        error,
        'summary_failed',
      );
    }
  }

  try {
    const categorized = await autoTagCategorizedStrict(content, originalTags);
    const aiTags: CategorizedTag[] = [...categorized.matched, ...categorized.suggested];
    const nextTags = aiTags.length > 0
      ? Array.from(new Set([...originalTags, ...aiTags.map((tag) => tag.name)]))
      : originalTags;
    if (aiTags.length > 0) {
      knowledge.patchItem(itemId, { tags: JSON.stringify(nextTags) });
    }
    syncItemTagSystem(itemId, buildTagCandidates(nextTags, aiTags));
  } catch (error) {
    if (!isKnowledgeEnhancementUnavailableError(error)) {
      processingError = appendProcessingError(
        processingError,
        '标签',
        error,
        'tag_generation_failed',
      );
    }
  }

  persist(chunks.length);
}
