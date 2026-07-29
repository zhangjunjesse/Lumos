// 图文入库(#55)。
//
// 关键复用点:图文读出来的文字,存进和视频转写**同一个** transcripts 集合。
// 这样它下游那两步 —— 总结、进知识库 —— 一行都不用改:它们只吃文本,不关心
// 这段文本是从音轨转写来的还是从图片上读来的。
//
// 图文和视频也共用 videos 集合,靠 content_type 区分。存量数据没有这个字段,
// 一律视为视频(见 resolveStoredContentKind)。分表要把 library_* 那 15 个入库
// 字段和相关逻辑复制两份,不划算。

import { COLLECTION_TRANSCRIPTS, COLLECTION_VIDEOS } from './constants';
import type { DouyinContentKind } from './parse-input';
import { extractNoteImageText, type NoteImageTextResult } from './note-image-text';
import { fetchNoteMetadata, type ScrapedNoteMetadata } from './note-scraper';
import { getDouyinCollectorStore } from './storage';

export interface NoteIngestOutcome {
  ok: boolean;
  videoId?: string;
  created?: boolean;
  summary?: string;
  reason?: string;
  phase?: 'fetch' | 'extract' | 'store';
  /** 图片取字的成本与降级情况,写进执行记录好让人看清钱花在哪、哪张没读出来。 */
  imageText?: NoteImageTextResult;
}

/** 存量行没有 content_type,一律当视频 —— 它们本来就只可能是视频。 */
export function resolveStoredContentKind(row: { content_type?: string } | null): DouyinContentKind {
  return row?.content_type === 'note' ? 'note' : 'video';
}

export function upsertNoteFromScrape(
  meta: ScrapedNoteMetadata,
): { id: string; created: boolean } {
  const store = getDouyinCollectorStore();
  const existing = store
    .query<{ id: string; aweme_id?: string }>(COLLECTION_VIDEOS, {
      filter: { aweme_id: meta.awemeId },
    })
    .at(0);
  const now = new Date().toISOString();

  const payload = {
    aweme_id: meta.awemeId,
    content_type: 'note' as const,
    creator_ref: meta.authorSecUid ?? null,
    creator_nickname: meta.authorNickname ?? null,
    title: meta.title ?? null,
    cover: meta.cover ?? null,
    // 图文没有时长。留 0 而不是编一个,免得时长筛选把它们排进"短视频"当真数据看。
    duration_seconds: 0,
    duration_bucket: 'short',
    language: 'zh-CN',
    subtitle_source: 'none',
    image_urls: meta.imageUrls.length > 0 ? JSON.stringify(meta.imageUrls) : null,
    audio_urls: meta.audioUrls.length > 0 ? JSON.stringify(meta.audioUrls) : null,
    updated_at: now,
  };

  if (existing) {
    store.update(COLLECTION_VIDEOS, existing.id, payload);
    return { id: existing.id, created: false };
  }
  const created = store.create(COLLECTION_VIDEOS, payload);
  return { id: created.id, created: true };
}

/** 把图片读出的文字存成转写记录 —— 和视频走同一个集合,下游因此完全复用。 */
function storeNoteText(videoId: string, text: string): void {
  const store = getDouyinCollectorStore();
  const now = new Date().toISOString();

  store.create(COLLECTION_TRANSCRIPTS, {
    video_ref: videoId,
    lang: 'zh-CN',
    source: 'note-text',
    segments: JSON.stringify([{ start: 0, end: 0, text }]),
    word_count: text.length,
    confidence: 0,
    updated_at: now,
  });

  store.update(COLLECTION_VIDEOS, videoId, {
    transcript_status: 'success',
    failure_reason: null,
    updated_at: now,
  });
}

function composeNoteText(meta: ScrapedNoteMetadata, imageText: string): string {
  // 正文在前、图上的字在后。图文的正文常常只是个标题,真内容都在图里,
  // 两段都要留 —— 只取正文的话总结基本等于没内容。
  return [meta.title?.trim(), imageText.trim()].filter(Boolean).join('\n\n');
}

/**
 * 采集一条图文:抓详情 → 读图上的字 → 落库 → 存文本。
 *
 * 总结和入库不在这里做 —— 它们由既有的自动处理链接手,对图文和视频一视同仁。
 */
export async function ingestNote(awemeId: string): Promise<NoteIngestOutcome> {
  const scraped = await fetchNoteMetadata(awemeId);
  if (!scraped.ok) {
    return { ok: false, phase: 'fetch', reason: scraped.reason };
  }

  const meta = scraped.metadata;
  const imageText = await extractNoteImageText(meta.imageUrls);
  const fullText = composeNoteText(meta, imageText.text);

  if (!fullText) {
    // 正文空、图也没读出字 —— 存一条空壳没有意义,如实报失败并说清哪一步断了。
    return {
      ok: false,
      phase: 'extract',
      reason: `图文 ${awemeId} 没有正文，图片里也没读出文字。`
        + (imageText.failures.length > 0 ? `原因：${imageText.failures.join('；')}` : ''),
      imageText,
    };
  }

  const { id, created } = upsertNoteFromScrape(meta);
  storeNoteText(id, fullText);

  const parts = [`已采集 1 条图文：${meta.title ?? meta.awemeId}`];
  if (imageText.ocrCount > 0) parts.push(`${imageText.ocrCount} 张图本地识别`);
  if (imageText.modelCount > 0) parts.push(`${imageText.modelCount} 张图用视觉模型识别`);
  if (imageText.skippedForLimit > 0) parts.push(`另有 ${imageText.skippedForLimit} 张图超出上限未读`);

  return {
    ok: true,
    videoId: id,
    created,
    summary: parts.join('，'),
    imageText,
  };
}
