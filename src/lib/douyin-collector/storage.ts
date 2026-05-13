import type { AppDataStore, AppRow } from '@/lib/app/runtime/data-store';
import { createAppDataStore } from '@/lib/app/runtime/data-store';
import { getAppPlatformService } from '@/lib/app/service';

import {
  COLLECTION_CREATORS,
  COLLECTION_JOBS,
  COLLECTION_KEYWORDS,
  COLLECTION_LIBRARY_LINKS,
  COLLECTION_TRANSCRIPTS,
  COLLECTION_VIDEOS,
  DOUYIN_COLLECTOR_APP_ID,
} from './constants';
import { parseTranscriptText, parseVideoTags } from './parsers';
import type {
  CollectJobRecord,
  CreatorRecord,
  KeywordRecord,
} from './types';

export type CreatorRow = AppRow<CreatorRecord>;
export type KeywordRow = AppRow<KeywordRecord>;
export type CollectJobRow = AppRow<CollectJobRecord>;

export function getDouyinCollectorStore(): AppDataStore {
  const svc = getAppPlatformService();
  return createAppDataStore(svc.db, DOUYIN_COLLECTOR_APP_ID);
}

export function listCreators(store: AppDataStore = getDouyinCollectorStore()): CreatorRow[] {
  return store.query<CreatorRecord>(COLLECTION_CREATORS, {
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 200,
  });
}

export function listKeywords(store: AppDataStore = getDouyinCollectorStore()): KeywordRow[] {
  return store.query<KeywordRecord>(COLLECTION_KEYWORDS, {
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 200,
  });
}

export function listJobs(store: AppDataStore = getDouyinCollectorStore()): CollectJobRow[] {
  return store.query<CollectJobRecord>(COLLECTION_JOBS, {
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 200,
  });
}

export interface LibraryStatusCounts {
  videos: number;
  unprocessed: number;
  drafts: number;
  published: number;
  discarded: number;
}

/**
 * Latest `updated_at` among published videos. Cheap single-row query
 * (uses `library_status` index + descending order). Used by the Hero
 * to show "上次入库 X 前" alongside the existing cookie / patrol
 * freshness signals.
 *
 * Returns null when no video has reached the published state.
 */
export function getLastPublishedAt(
  store: AppDataStore = getDouyinCollectorStore(),
): string | null {
  const rows = store.query<{ updated_at?: string }>(COLLECTION_VIDEOS, {
    filter: { library_status: 'published' },
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 1,
  });
  return rows[0]?.updated_at ?? null;
}

export function countLibraryStatus(
  store: AppDataStore = getDouyinCollectorStore(),
): LibraryStatusCounts {
  return {
    videos: store.count(COLLECTION_VIDEOS),
    unprocessed: store.count(COLLECTION_VIDEOS, { library_status: 'unprocessed' }),
    drafts: store.count(COLLECTION_VIDEOS, { library_status: 'draft' }),
    published: store.count(COLLECTION_VIDEOS, { library_status: 'published' }),
    discarded: store.count(COLLECTION_VIDEOS, { library_status: 'discarded' }),
  };
}

export interface AsrSpend {
  /** Total ¥ paid for ASR transcripts on file. */
  totalAmount: number;
  /** Number of videos with a recorded ASR cost (count, not duration). */
  videoCount: number;
  /** Same restricted to the last 30 days, so the figure stays current. */
  last30dAmount: number;
  last30dVideoCount: number;
}

const SPEND_WINDOW_MS = 30 * 24 * 60 * 60_000;

/**
 * Aggregate ASR spend across the whole video collection. Surfaces the
 * one PM question every cloud-billed user has: "how much have I burned
 * on transcribes this month?". Reads `transcript_charged_amount` on
 * each video row — populated by transcribe.ts when ASR succeeded.
 *
 * Honest contract: only counts videos where the field is a positive
 * number. Native-subtitle transcripts (free) and failed transcribes
 * are silently skipped — they didn't cost anything.
 */
export function aggregateAsrSpend(
  store: AppDataStore = getDouyinCollectorStore(),
  now: Date = new Date(),
): AsrSpend {
  const rows = store.query<{
    transcript_charged_amount?: number | null;
    updated_at?: string;
  }>(COLLECTION_VIDEOS, { limit: 100_000 });
  const cutoff = now.getTime() - SPEND_WINDOW_MS;
  const spend: AsrSpend = {
    totalAmount: 0,
    videoCount: 0,
    last30dAmount: 0,
    last30dVideoCount: 0,
  };
  for (const row of rows) {
    const amount = row.transcript_charged_amount;
    if (typeof amount !== 'number' || !(amount > 0)) continue;
    spend.totalAmount += amount;
    spend.videoCount += 1;
    const ts = row.updated_at ? Date.parse(row.updated_at) : NaN;
    if (Number.isFinite(ts) && ts >= cutoff) {
      spend.last30dAmount += amount;
      spend.last30dVideoCount += 1;
    }
  }
  return spend;
}

export interface LibraryBacklog {
  transcribePending: number;
  transcribeFailed: number;
  publishReady: number;
  recent7d: number;
  starred: number;
}

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60_000;

/**
 * Count "actionable" video subsets for the library smart-filter chips.
 *
 * - transcribePending: videos that still need字幕 (transcript_status not
 *   `success`), excluding 丢弃 — the user has explicitly opted those out.
 * - publishReady: 已有字幕, library_status 还在 unprocessed/draft —
 *   one click away from being published. The knowledge pipeline generates
 *   the index summary during publish.
 * - recent7d: created in the past 7 days regardless of state — surfaces
 *   "what's new" without requiring sort change.
 *
 * Counts are honest: each chip reflects the exact number the user will
 * see when they click it (server-side filter uses the same predicates).
 */
export function countLibraryBacklog(
  store: AppDataStore = getDouyinCollectorStore(),
  now: Date = new Date(),
): LibraryBacklog {
  const all = store.query<{
    transcript_status?: string;
    library_status?: string;
    created_at?: string;
    starred?: boolean;
  }>(COLLECTION_VIDEOS, { limit: 5000 });
  const cutoff = now.getTime() - RECENT_WINDOW_MS;

  let transcribePending = 0;
  let transcribeFailed = 0;
  let publishReady = 0;
  let recent7d = 0;
  let starred = 0;

  for (const v of all) {
    const status = v.library_status ?? 'unprocessed';
    const transcribed = v.transcript_status === 'success';
    const transcribeFailedFlag = v.transcript_status === 'failed';
    // Round 164: failed videos must NOT count under transcribePending
    // (they're already represented in the transcribeFailed bucket).
    // Pre-fix the chip "1 待抓字幕" lit up at the same time as the chip
    // "1 抓字幕失败" for the same row → user sees 2 backlog items but
    // there's only 1 video. Honest semantics: pending = "not yet
    // attempted or in-flight"; failed = "tried and failed".
    if (status !== 'discarded' && !transcribed && !transcribeFailedFlag) {
      transcribePending += 1;
    }
    if (status !== 'discarded' && transcribeFailedFlag) transcribeFailed += 1;
    if (transcribed && (status === 'unprocessed' || status === 'draft')) {
      publishReady += 1;
    }
    if (v.created_at) {
      const t = Date.parse(v.created_at);
      if (Number.isFinite(t) && t >= cutoff) recent7d += 1;
    }
    if (v.starred === true) starred += 1;
  }

  return { transcribePending, transcribeFailed, publishReady, recent7d, starred };
}

export type LibraryBacklogKey = keyof LibraryBacklog;

/**
 * Predicate that mirrors `countLibraryBacklog` for in-memory filtering.
 * Used by the videos route so chip-clicked filters return exactly the
 * same set the count promised.
 */
export function matchesBacklog(
  v: {
    transcript_status?: string;
    library_status?: string;
    created_at?: string;
    starred?: boolean;
  },
  key: LibraryBacklogKey,
  now: Date = new Date(),
): boolean {
  const status = v.library_status ?? 'unprocessed';
  const transcribed = v.transcript_status === 'success';
  switch (key) {
    case 'transcribePending':
      // Mirror count semantics (Round 164): failed videos belong to
      // the transcribeFailed bucket, not pending.
      return status !== 'discarded' && !transcribed && v.transcript_status !== 'failed';
    case 'transcribeFailed':
      return status !== 'discarded' && v.transcript_status === 'failed';
    case 'publishReady':
      return transcribed && (status === 'unprocessed' || status === 'draft');
    case 'recent7d':
      if (!v.created_at) return false;
      const t = Date.parse(v.created_at);
      if (!Number.isFinite(t)) return false;
      return t >= now.getTime() - RECENT_WINDOW_MS;
    case 'starred':
      return v.starred === true;
  }
}

export function countQueue(
  store: AppDataStore = getDouyinCollectorStore(),
): {
  runningJobs: number;
  pendingJobs: number;
  lastRunFailure: string | null;
  lastRunAt: string | null;
  lastPatrolAt: string | null;
} {
  const running = store.count(COLLECTION_JOBS, { status: 'running' });
  const queued = store.count(COLLECTION_JOBS, { status: 'queued' });

  // Two distinct timestamps to keep semantics honest:
  //
  //  - lastRunAt:    any event (collect_job OR run_history). Drives
  //                  "did the most-recent run fail?" gating + the
  //                  "system is alive" tooltip.
  //  - lastPatrolAt: collect_jobs only. Drives the patrol-stale
  //                  warning ("巡更 X 时间前 · 调度可能失效"). Round
  //                  147 collapsed both into lastRunAt, which let a
  //                  manual transcribe (run_history) reset the
  //                  patrol-stale timer even if collect_jobs hadn't
  //                  fired in days. False-negative on broken patrol.
  const lastJob = store.query<CollectJobRecord>(COLLECTION_JOBS, {
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 1,
  });
  const lastRun = store.query<{
    status?: string;
    failure_reason?: string | null;
    updated_at?: string;
  }>('run_history', {
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 1,
  });
  const lastJobAt = lastJob[0]?.updated_at ?? null;
  const lastRunHistAt = lastRun[0]?.updated_at ?? null;
  const newer =
    (lastRunHistAt ?? '') > (lastJobAt ?? '')
      ? {
          status: lastRun[0]?.status,
          reason: lastRun[0]?.failure_reason ?? null,
          at: lastRunHistAt,
        }
      : {
          status: lastJob[0]?.status,
          reason: lastJob[0]?.failure_reason ?? null,
          at: lastJobAt,
        };
  const lastRunFailure = newer.status === 'failed' ? newer.reason : null;

  return {
    runningJobs: running,
    pendingJobs: queued,
    lastRunFailure,
    lastRunAt: newer.at,
    lastPatrolAt: lastJobAt,
  };
}

/**
 * Find video ids whose transcript text contains `query` (case-insensitive
 * substring match on the joined segment text). Used by the library
 * full-text search toggle so users can find videos by something the
 * speaker said, even when the title / summary doesn't mention it.
 *
 * Honest contract:
 *   - Query under 2 chars returns an empty set — protects against
 *     accidentally scanning thousands of transcripts for a single
 *     character that matches everything.
 *   - Returns video ids (the `videos` collection row id), NOT aweme_id
 *     and NOT the transcript row id; callers want to intersect with
 *     `videos` query results.
 *   - `parseTranscriptText` collapses to lowercase + `\n` join — same
 *     normalization as Library card display, so "what you see is what
 *     you search."
 */
export function findVideoIdsByTranscriptContent(
  query: string,
  store: AppDataStore = getDouyinCollectorStore(),
): Set<string> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return new Set();
  const rows = store.query<{ video_ref?: string; segments?: string }>(
    COLLECTION_TRANSCRIPTS,
    { limit: 10_000 },
  );
  const ids = new Set<string>();
  for (const r of rows) {
    if (!r.video_ref) continue;
    const text = parseTranscriptText(r.segments).toLowerCase();
    if (text.includes(q)) ids.add(r.video_ref);
  }
  return ids;
}

/**
 * Like `findVideoIdsByTranscriptContent` but also returns the first
 * matching ~120-char snippet (window centered on the first hit). The
 * snippet preserves original casing — only the search itself is
 * case-insensitive. UI uses this to render an inline preview under the
 * card title so users see *where* in the transcript the match lives,
 * without opening the panel.
 *
 * Edge cases:
 *   - query under 2 chars → empty map (matches the bare-id helper).
 *   - snippet shorter than the window → returned in full, no ellipsis.
 *   - hit at the very start / end → no leading / trailing ellipsis.
 */
export function findTranscriptSnippets(
  query: string,
  store: AppDataStore = getDouyinCollectorStore(),
): Map<string, string> {
  const q = query.trim();
  if (q.length < 2) return new Map();
  const ql = q.toLowerCase();
  const rows = store.query<{ video_ref?: string; segments?: string }>(
    COLLECTION_TRANSCRIPTS,
    { limit: 10_000 },
  );
  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.video_ref || out.has(r.video_ref)) continue;
    const text = parseTranscriptText(r.segments);
    const idx = text.toLowerCase().indexOf(ql);
    if (idx < 0) continue;
    out.set(r.video_ref, sliceSnippet(text, idx, q.length));
  }
  return out;
}

const SNIPPET_HALF = 60;

function sliceSnippet(text: string, hitStart: number, hitLen: number): string {
  const start = Math.max(0, hitStart - SNIPPET_HALF);
  const end = Math.min(text.length, hitStart + hitLen + SNIPPET_HALF);
  const slice = text.slice(start, end).replace(/\s+/g, ' ');
  return `${start > 0 ? '…' : ''}${slice}${end < text.length ? '…' : ''}`;
}

export interface ActivityDigest {
  windowHours: number;
  windowStart: string;
  newVideos: number;
  uniqueCreators: number;
  newTags: string[];
  publishedInWindow: number;
  starredInWindow: number;
  failedRuns: number;
}

const DIGEST_TAG_LIMIT = 8;

/**
 * Summarize what happened in the last N hours: new videos in, who they
 * came from, which tags first appeared in this window, how many made it
 * to "published" status, how many failed runs landed. Surfaces the
 * "what's new since I last looked" view that the per-collection counts
 * don't capture (they're cumulative).
 *
 * Honest contract:
 *   - "newTags" are tags whose earliest-seen video is inside the window.
 *     A tag the user has been using for months is excluded; a tag that
 *     first appeared yesterday is included.
 *   - "publishedInWindow" / "starredInWindow" use updated_at because we
 *     don't track per-field timestamps. So a video re-published today
 *     will count even if it was first published last week. Documented
 *     intentionally — same-day churn is meaningful signal.
 */
export function summarizeRecentActivity(
  now: Date = new Date(),
  windowHours = 24,
  store: AppDataStore = getDouyinCollectorStore(),
): ActivityDigest {
  const windowMs = Math.max(1, windowHours) * 60 * 60_000;
  const cutoff = now.getTime() - windowMs;
  const windowStart = new Date(cutoff).toISOString();

  const allVideos = store.query<{
    id: string;
    aweme_id?: string;
    creator_ref?: string | null;
    tags?: string | null;
    library_status?: string;
    starred?: boolean;
    created_at?: string;
    updated_at?: string;
  }>(COLLECTION_VIDEOS, { limit: 5000 });

  let newVideos = 0;
  const creatorSet = new Set<string>();
  let publishedInWindow = 0;
  let starredInWindow = 0;
  // Track each tag's earliest-seen timestamp across the entire library
  // — needed to decide if a tag first appeared inside the window.
  const tagFirstSeen = new Map<string, number>();
  const tagInsideWindow = new Set<string>();

  for (const v of allVideos) {
    const created = v.created_at ? Date.parse(v.created_at) : NaN;
    const updated = v.updated_at ? Date.parse(v.updated_at) : NaN;
    const inWindow = Number.isFinite(created) && created >= cutoff;
    const updatedInWindow = Number.isFinite(updated) && updated >= cutoff;

    if (inWindow) {
      newVideos += 1;
      if (v.creator_ref) creatorSet.add(v.creator_ref);
    }
    if (updatedInWindow && v.library_status === 'published') publishedInWindow += 1;
    if (updatedInWindow && v.starred === true) starredInWindow += 1;

    const tags = parseVideoTags(v.tags);
    for (const t of tags) {
      const key = t.toLowerCase();
      const ts = Number.isFinite(created) ? created : Number.isFinite(updated) ? updated : NaN;
      if (!Number.isFinite(ts)) continue;
      const prev = tagFirstSeen.get(key);
      if (prev === undefined || ts < prev) tagFirstSeen.set(key, ts);
      if (inWindow) tagInsideWindow.add(key);
    }
  }

  // A tag is "new" if its earliest sighting is inside the window. We
  // intersect with `tagInsideWindow` to avoid surfacing tags that came in
  // via update of an OLD video (false novelty).
  const newTags: string[] = [];
  for (const key of tagInsideWindow) {
    const earliest = tagFirstSeen.get(key);
    if (earliest !== undefined && earliest >= cutoff) {
      newTags.push(key);
    }
  }
  newTags.sort();
  const newTagsCapped = newTags.slice(0, DIGEST_TAG_LIMIT);

  // Failures from run_history within the window. Captures auto-pipeline
  // failures + cookie probe failures + summarize/transcribe failures.
  const failedRuns = store.query<{ status?: string; updated_at?: string }>('run_history', {
    filter: { status: 'failed' },
    limit: 500,
  }).filter((r) => {
    const t = r.updated_at ? Date.parse(r.updated_at) : NaN;
    return Number.isFinite(t) && t >= cutoff;
  }).length;

  return {
    windowHours,
    windowStart,
    newVideos,
    uniqueCreators: creatorSet.size,
    newTags: newTagsCapped,
    publishedInWindow,
    starredInWindow,
    failedRuns,
  };
}

export const COLLECTIONS = {
  creators: COLLECTION_CREATORS,
  keywords: COLLECTION_KEYWORDS,
  jobs: COLLECTION_JOBS,
  videos: COLLECTION_VIDEOS,
  transcripts: COLLECTION_TRANSCRIPTS,
  libraryLinks: COLLECTION_LIBRARY_LINKS,
};

/**
 * Cascade-delete dependent rows when a video is removed.
 *
 * Honest contract:
 *   - transcripts: 1:1 with video, no meaning without it. Deleted.
 *   - library_links: pointers from this video to a kb_collection.
 *     Deleted (the dangling pointer would return stale "已入库" UI).
 *   - kb_items themselves are NOT touched — those are user-curated
 *     knowledge content in the global library, intentionally outliving
 *     the source video. The pointer goes; the content stays.
 *   - Returns the per-collection counts so caller / UI can audit.
 *
 * Caller is expected to delete the video row itself afterward.
 */
export function cascadeDeleteVideoChildren(
  videoId: string,
  store: AppDataStore = getDouyinCollectorStore(),
): { transcripts: number; libraryLinks: number } {
  const transcripts = store.query<{ id: string }>(COLLECTION_TRANSCRIPTS, {
    filter: { video_ref: videoId },
  });
  for (const t of transcripts) {
    store.delete(COLLECTION_TRANSCRIPTS, t.id);
  }
  const links = store.query<{ id: string }>(COLLECTION_LIBRARY_LINKS, {
    filter: { video_ref: videoId },
  });
  for (const l of links) {
    store.delete(COLLECTION_LIBRARY_LINKS, l.id);
  }
  return { transcripts: transcripts.length, libraryLinks: links.length };
}

export interface CreatorStats {
  creatorRef: string;
  collected: number;
  transcribed: number;
  published: number;
}

export interface KeywordStats {
  query: string;
  collected: number;
  transcribed: number;
  published: number;
}

/**
 * Per-keyword counts: a video counts toward a keyword if its `tags` array
 * contains the keyword's `query` (case-insensitive). Returned as a map
 * keyed by lowercased query. Single pass over videos.
 */
export function statsByKeyword(
  store: AppDataStore = getDouyinCollectorStore(),
): Map<string, KeywordStats> {
  const keywords = store.query<{ query?: string }>(COLLECTION_KEYWORDS, { limit: 500 });
  const map = new Map<string, KeywordStats>();
  for (const k of keywords) {
    if (typeof k.query !== 'string' || !k.query) continue;
    map.set(k.query.toLowerCase(), {
      query: k.query,
      collected: 0,
      transcribed: 0,
      published: 0,
    });
  }
  if (map.size === 0) return map;

  const videos = store.query<{
    tags?: string | null;
    transcript_status?: string;
    library_status?: string;
  }>(COLLECTION_VIDEOS, { limit: 5000 });
  for (const v of videos) {
    const tags = parseVideoTags(v.tags);
    if (tags.length === 0) continue;
    const seen = new Set<string>();
    for (const t of tags) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const stats = map.get(key);
      if (!stats) continue;
      stats.collected += 1;
      if (v.transcript_status === 'success') stats.transcribed += 1;
      if (v.library_status === 'published') stats.published += 1;
    }
  }
  return map;
}

export interface TagFrequency {
  tag: string;
  count: number;
}

/**
 * Top-N most-used tags across non-discarded videos. Counts each video at
 * most once per distinct (case-insensitive) tag. Display label uses the
 * casing from whichever video first defined it. Returned sorted by
 * count desc.
 */
export function topTags(
  limit = 12,
  store: AppDataStore = getDouyinCollectorStore(),
): TagFrequency[] {
  const videos = store.query<{ tags?: string | null; library_status?: string }>(
    COLLECTION_VIDEOS,
    { limit: 5000 },
  );
  const counts = new Map<string, { display: string; count: number }>();
  for (const v of videos) {
    if (v.library_status === 'discarded') continue;
    const tags = parseVideoTags(v.tags);
    const seen = new Set<string>();
    for (const t of tags) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const cell = counts.get(key);
      if (cell) cell.count += 1;
      else counts.set(key, { display: t, count: 1 });
    }
  }
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((c) => ({ tag: c.display, count: c.count }));
}

export interface RelatedVideo {
  id: string;
  awemeId: string | null;
  title: string | null;
  creatorNickname: string | null;
  cover: string | null;
  durationSeconds: number;
  libraryStatus: string | null;
  sharedTags: string[];
  overlap: number;
}

interface VideoForRelated {
  id: string;
  aweme_id?: string;
  title?: string | null;
  creator_nickname?: string | null;
  cover?: string | null;
  duration_seconds?: number;
  library_status?: string;
  tags?: string | null;
}

/**
 * Find library videos that share at least one tag with the given video.
 * Sorted by overlap descending then by `updated_at` to surface fresher
 * content. Discarded videos are excluded.
 *
 * Cheap implementation: full table scan up to 5000 videos. Suitable for
 * the desktop scale (10k videos × ~1ms per scan = 10ms) without an
 * inverted-index. Revisit if the library grows past 50k.
 */
export function findRelatedVideos(
  videoId: string,
  limit = 6,
  store: AppDataStore = getDouyinCollectorStore(),
): RelatedVideo[] {
  const all = store.query<VideoForRelated>(COLLECTION_VIDEOS, {
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 5000,
  });
  const target = all.find((v) => v.id === videoId);
  if (!target) return [];
  const targetTags = parseVideoTags(target.tags).map((t) => t.toLowerCase());
  if (targetTags.length === 0) return [];
  const targetSet = new Set(targetTags);

  const scored: Array<{ video: VideoForRelated; overlapTags: string[] }> = [];
  for (const v of all) {
    if (v.id === videoId) continue;
    if (v.library_status === 'discarded') continue;
    const tags = parseVideoTags(v.tags);
    const shared = tags.filter((t) => targetSet.has(t.toLowerCase()));
    if (shared.length === 0) continue;
    scored.push({ video: v, overlapTags: shared });
  }
  scored.sort((a, b) => b.overlapTags.length - a.overlapTags.length);

  return scored.slice(0, limit).map(({ video, overlapTags }) => ({
    id: video.id,
    awemeId: video.aweme_id ?? null,
    title: video.title ?? null,
    creatorNickname: video.creator_nickname ?? null,
    cover: video.cover ?? null,
    durationSeconds: video.duration_seconds ?? 0,
    libraryStatus: video.library_status ?? null,
    sharedTags: overlapTags,
    overlap: overlapTags.length,
  }));
}

/**
 * Per-creator counts of collected / transcribed / published videos.
 * Returned as a map keyed by `creator_ref` (sec_uid). Cheap single pass.
 */
export function statsByCreator(
  store: AppDataStore = getDouyinCollectorStore(),
): Map<string, CreatorStats> {
  const map = new Map<string, CreatorStats>();
  const videos = store.query<{
    creator_ref?: string | null;
    transcript_status?: string;
    library_status?: string;
  }>(COLLECTION_VIDEOS, { limit: 5000 });
  for (const v of videos) {
    const key = v.creator_ref ?? '';
    if (!key) continue;
    const stats =
      map.get(key) ??
      ({ creatorRef: key, collected: 0, transcribed: 0, published: 0 } satisfies CreatorStats);
    stats.collected += 1;
    if (v.transcript_status === 'success') stats.transcribed += 1;
    if (v.library_status === 'published') stats.published += 1;
    map.set(key, stats);
  }
  return map;
}
