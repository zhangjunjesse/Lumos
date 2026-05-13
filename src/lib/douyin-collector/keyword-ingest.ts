import {
  COLLECTION_KEYWORDS,
  COLLECTION_VIDEOS,
} from './constants';
import { parseDouyinInput } from './parse-input';
import { parseVideoTags } from './parsers';
import { fetchVideoMetadata, resolveShortLink, type ScrapedVideoMetadata } from './scraper';
import { getDouyinCollectorStore } from './storage';
import type { KeywordRecord } from './types';

export interface KeywordIngestReport {
  ok: boolean;
  processed: number;
  succeeded: number;
  failed: number;
  reasons: string[];
  message: string;
}

interface VideoRow {
  id: string;
  aweme_id?: string;
  tags?: string | null;
}

/**
 * Manually ingest a batch of video URLs / aweme IDs under a keyword
 * subscription. Each URL is scraped via the existing share-page fetcher;
 * the resulting video record is tagged with the keyword's `query` so the
 * Library tag-click filter can pull all videos curated under this topic.
 *
 * This bypasses the still-stub douyin search backend — the user manually
 * supplies URLs they've gathered (from douyin search, recommendations,
 * etc), and the app does the metadata + tagging + dedup heavy lifting.
 */
export async function ingestKeywordVideos(
  keywordId: string,
  rawInputs: string[],
): Promise<KeywordIngestReport> {
  const store = getDouyinCollectorStore();
  const keyword = store.get<KeywordRecord>(COLLECTION_KEYWORDS, keywordId);
  if (!keyword) {
    return {
      ok: false,
      processed: 0,
      succeeded: 0,
      failed: 0,
      reasons: ['关键词记录不存在。'],
      message: '关键词记录不存在。',
    };
  }

  const inputs = rawInputs
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0);
  if (inputs.length === 0) {
    return {
      ok: true,
      processed: 0,
      succeeded: 0,
      failed: 0,
      reasons: [],
      message: '没有有效的链接。',
    };
  }

  const failures: string[] = [];
  let succeeded = 0;
  for (const raw of inputs) {
    let parsed = parseDouyinInput(raw);
    if (parsed.kind === 'short-url') {
      const resolved = await resolveShortLink(parsed.shortToken);
      if (!resolved) {
        failures.push(`短链解析失败：${raw}`);
        continue;
      }
      parsed = parseDouyinInput(resolved);
    }
    let awemeId: string | null = null;
    if (parsed.kind === 'aweme_id') awemeId = parsed.awemeId;
    else if (parsed.kind === 'video-url') awemeId = parsed.awemeId;
    if (!awemeId) {
      failures.push(`无法解析 aweme_id：${raw}`);
      continue;
    }

    const outcome = await fetchVideoMetadata(awemeId);
    if (!outcome.ok) {
      failures.push(outcome.reason);
      continue;
    }

    upsertWithKeywordTag(outcome.metadata.awemeId, outcome.metadata, keyword.query);
    succeeded += 1;
  }

  // Mark the keyword as freshly checked when at least one ingest succeeds.
  // Also clear last_failure_reason — a successful manual ingest supersedes
  // any prior auto-patrol failure (e.g. "多词关键词需 X-Bogus 签名" stub
  // message). Without this, the keyword row would keep showing red text
  // even after the user routed around the failure manually.
  if (succeeded > 0) {
    store.update<KeywordRecord>(COLLECTION_KEYWORDS, keyword.id, {
      last_checked_at: new Date().toISOString(),
      last_failure_reason: null,
      updated_at: new Date().toISOString(),
    });
  }

  const failed = inputs.length - succeeded;
  const distinctReasons = Array.from(new Set(failures)).slice(0, 3);
  const message =
    failed === 0
      ? `已 ingest ${succeeded} 条视频，并打上「${keyword.query}」标签。`
      : `${succeeded} 成功 / ${failed} 失败${
          distinctReasons.length > 0 ? `（${distinctReasons.join('；')}）` : ''
        }`;

  return {
    ok: failed === 0,
    processed: inputs.length,
    succeeded,
    failed,
    reasons: distinctReasons,
    message,
  };
}

function upsertWithKeywordTag(
  awemeId: string,
  meta: ScrapedVideoMetadata,
  keywordQuery: string,
): void {
  const store = getDouyinCollectorStore();
  const existing = store
    .query<VideoRow>(COLLECTION_VIDEOS, { filter: { aweme_id: awemeId } })
    .at(0);
  const now = new Date().toISOString();

  const subtitleSource = meta.nativeSubtitleUrls.length > 0 ? 'native' : 'none';
  const durationBucket =
    !meta.duration ? 'short'
      : meta.duration < 60 ? 'short'
        : meta.duration < 600 ? 'medium'
          : 'long';

  // Merge keyword tag into existing tags array (dedup case-insensitively).
  const existingTags = parseVideoTags(existing?.tags);
  const lowered = new Set(existingTags.map((t) => t.toLowerCase()));
  const mergedTags = [...existingTags];
  if (!lowered.has(keywordQuery.toLowerCase())) mergedTags.push(keywordQuery);

  const payload = {
    aweme_id: meta.awemeId,
    creator_ref: meta.authorSecUid ?? null,
    creator_nickname: meta.authorNickname ?? null,
    title: meta.title ?? null,
    cover: meta.cover ?? null,
    duration_seconds: meta.duration ?? 0,
    duration_bucket: durationBucket,
    language: 'zh-CN',
    subtitle_source: subtitleSource,
    native_subtitle_urls:
      meta.nativeSubtitleUrls.length > 0 ? JSON.stringify(meta.nativeSubtitleUrls) : null,
    play_addr_urls:
      meta.playAddrUrls.length > 0 ? JSON.stringify(meta.playAddrUrls) : null,
    transcript_status: existing ? undefined : 'pending',
    library_status: existing ? undefined : 'unprocessed',
    tags: JSON.stringify(mergedTags),
    failure_reason: null,
    // Round 165: explicit created_at on new rows so recent7d chip works
    // (existing rows keep their original created_at via the undefined
    // filter below, since we don't want to retroactively bump it).
    created_at: existing ? undefined : now,
    updated_at: now,
  };
  if (existing) {
    // Strip undefined fields so we don't overwrite real values with undefined.
    const patch = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined),
    );
    store.update(COLLECTION_VIDEOS, existing.id, patch);
  } else {
    store.create(COLLECTION_VIDEOS, payload);
  }
}

