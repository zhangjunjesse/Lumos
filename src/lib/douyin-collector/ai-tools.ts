import {
  COLLECTION_CREATORS,
  COLLECTION_JOBS,
  COLLECTION_KEYWORDS,
  COLLECTION_VIDEOS,
} from './constants';
import { summarizeVideo } from './ai-summary';
import { createJob, runJob } from './jobs';
import { parseDouyinInput } from './parse-input';
import { cleanKeywordQuery, parseVideoTags } from './parsers';
import { publishVideoToKnowledge } from './publish';
import { fetchVideoMetadata, resolveShortLink } from './scraper';
import { getDouyinCollectorSettings } from './settings';
import {
  getDouyinCollectorStore,
  listCreators,
  listKeywords,
  type CollectJobRow,
} from './storage';
import { transcribeVideoFromNative } from './transcribe';
import type { TranscribePrefer } from './settings';
import type { CreatorCadence, CreatorRecord, KeywordRecord, KeywordTimeWindow } from './types';

type AiOutcome<T> = ({ ok: true } & T) | { ok: false; error: string; phase?: string };

export interface DouyinAiVideo {
  id: string;
  aweme_id?: string | null;
  title?: string | null;
  creator_nickname?: string | null;
  creator_ref?: string | null;
  duration_seconds?: number | null;
  transcript_status?: string | null;
  library_status?: string | null;
  library_collection_id?: string | null;
  summary?: string | null;
  cover?: string | null;
  updated_at?: string | null;
}

interface VideoRow extends DouyinAiVideo {
  tags?: string | null;
}

export interface ProcessBatchResult {
  attempted: number;
  succeeded: number;
  failed: number;
  failures: Array<{
    videoId: string;
    awemeId?: string | null;
    phase?: string;
    error: string;
  }>;
}

export interface CollectForAiOptions {
  limit?: number;
  autoProcess?: boolean;
  publishToKnowledge?: boolean;
}

export interface ProcessVideoForAiInput {
  videoId?: string | null;
  awemeId?: string | null;
  input?: string | null;
  transcribe?: boolean;
  summarize?: boolean;
  publishToKnowledge?: boolean;
  forceTranscribe?: boolean;
  prefer?: TranscribePrefer;
}

export async function collectVideoForAi(
  input: string,
  opts: CollectForAiOptions = {},
): Promise<AiOutcome<{ job: CollectJobRow | null; video: DouyinAiVideo | null; process?: unknown }>> {
  const resolved = await resolveAwemeInput(input);
  if (!resolved.ok) return resolved;

  const job = createJob({
    kind: 'link',
    targetRef: resolved.targetRef,
    autoProcess: opts.autoProcess,
    publishToKnowledge: opts.publishToKnowledge,
  });
  const finalJob = await runJob(job.id);
  const video = findVideoByAwemeId(resolved.awemeId);
  let process: unknown;
  if (video && opts.autoProcess) {
    process = await processVideoForAi({
      videoId: video.id,
      transcribe: true,
      summarize: true,
      publishToKnowledge: opts.publishToKnowledge ?? true,
    });
  }
  return { ok: true, job: finalJob, video: serializeVideo(video), process };
}

export async function collectCreatorForAi(
  input: string,
  opts: CollectForAiOptions & { nickname?: string | null; cadence?: CreatorCadence | string | null } = {},
): Promise<AiOutcome<{
  creator: CreatorRecord & { id: string };
  job: CollectJobRow | null;
  videos: DouyinAiVideo[];
  process?: ProcessBatchResult;
}>> {
  const creatorResult = await ensureCreatorForAi(input, {
    nickname: opts.nickname,
    cadence: opts.cadence,
  });
  if (!creatorResult.ok) return creatorResult;

  const job = createJob({
    kind: 'creator',
    targetRef: creatorResult.creator.id,
    autoProcess: opts.autoProcess,
    publishToKnowledge: opts.publishToKnowledge,
  });
  const finalJob = await runJob(job.id);
  const videos = listVideosByCreator(creatorResult.creator.sec_uid ?? '', opts.limit ?? 30);

  let process: ProcessBatchResult | undefined;
  if (opts.autoProcess) {
    process = await processVideosBestEffort(videos, opts.publishToKnowledge ?? true);
  }

  return {
    ok: true,
    creator: creatorResult.creator,
    job: finalJob,
    videos: videos.map(serializeVideo).filter((v): v is DouyinAiVideo => Boolean(v)),
    process,
  };
}

export async function collectKeywordForAi(
  query: string,
  opts: CollectForAiOptions & {
    timeWindow?: KeywordTimeWindow | string | null;
    dedupeWindowDays?: number | null;
    cadence?: CreatorCadence | string | null;
  } = {},
): Promise<AiOutcome<{
  keyword: KeywordRecord & { id: string };
  job: CollectJobRow | null;
  videos: DouyinAiVideo[];
  process?: ProcessBatchResult;
}>> {
  const keywordResult = ensureKeywordForAi(query, {
    timeWindow: opts.timeWindow,
    dedupeWindowDays: opts.dedupeWindowDays,
    cadence: opts.cadence,
  });
  if (!keywordResult.ok) return keywordResult;

  const job = createJob({
    kind: 'keyword',
    targetRef: keywordResult.keyword.id,
    autoProcess: opts.autoProcess,
    publishToKnowledge: opts.publishToKnowledge,
  });
  const finalJob = await runJob(job.id);
  const videos = listVideosByKeyword(keywordResult.keyword.query, opts.limit ?? 30);

  let process: ProcessBatchResult | undefined;
  if (opts.autoProcess) {
    process = await processVideosBestEffort(videos, opts.publishToKnowledge ?? true);
  }

  return {
    ok: true,
    keyword: keywordResult.keyword,
    job: finalJob,
    videos: videos.map(serializeVideo).filter((v): v is DouyinAiVideo => Boolean(v)),
    process,
  };
}

export async function batchCollectForAi(input: {
  creators?: string[];
  keywords?: string[];
  links?: string[];
  limitPerSource?: number;
  autoProcess?: boolean;
  publishToKnowledge?: boolean;
}): Promise<AiOutcome<{ results: unknown[]; failures: Array<{ input: string; error: string }> }>> {
  const results: unknown[] = [];
  const failures: Array<{ input: string; error: string }> = [];
  const limit = Math.max(1, Math.min(100, Number(input.limitPerSource ?? 30)));
  // 默认开启处理（采集即抓字幕→总结→入库）；仅显式传 false 才只采元数据。
  const autoProcess = input.autoProcess !== false;
  const publishToKnowledge = input.publishToKnowledge ?? true;

  for (const creator of (input.creators ?? []).slice(0, 20)) {
    const out = await collectCreatorForAi(creator, { limit, autoProcess, publishToKnowledge });
    if (out.ok) {
      const jobFailure = failedJobReason(out);
      if (jobFailure) failures.push({ input: creator, error: jobFailure });
      else results.push({ kind: 'creator', input: creator, ...out });
    } else {
      failures.push({ input: creator, error: out.error });
    }
  }
  for (const keyword of (input.keywords ?? []).slice(0, 20)) {
    const out = await collectKeywordForAi(keyword, { limit, autoProcess, publishToKnowledge });
    if (out.ok) {
      const jobFailure = failedJobReason(out);
      if (jobFailure) failures.push({ input: keyword, error: jobFailure });
      else results.push({ kind: 'keyword', input: keyword, ...out });
    } else {
      failures.push({ input: keyword, error: out.error });
    }
  }
  for (const link of (input.links ?? []).slice(0, 50)) {
    const out = await collectVideoForAi(link, { autoProcess, publishToKnowledge });
    if (out.ok) {
      const jobFailure = failedJobReason(out);
      if (jobFailure) failures.push({ input: link, error: jobFailure });
      else results.push({ kind: 'link', input: link, ...out });
    } else {
      failures.push({ input: link, error: out.error });
    }
  }

  return { ok: true, results, failures };
}

export async function processVideoForAi(
  input: ProcessVideoForAiInput,
): Promise<AiOutcome<{
  video: DouyinAiVideo;
  transcribe?: unknown;
  summary?: unknown;
  publish?: unknown;
}>> {
  const resolved = await resolveVideoForAi(input);
  if (!resolved.ok) return resolved;

  const transcribe = input.transcribe === false
    ? undefined
    : await transcribeVideoFromNative(resolved.video.id, {
        force: Boolean(input.forceTranscribe),
        prefer: input.prefer,
      });
  if (transcribe && !transcribe.ok) {
    return {
      ok: false,
      phase: 'transcribe',
      error: transcribe.reason,
    };
  }

  const summary = input.summarize === false ? undefined : await summarizeVideo(resolved.video.id);
  if (summary && !summary.ok) {
    return {
      ok: false,
      phase: 'summarize',
      error: summary.reason,
    };
  }

  let publish: unknown;
  if (input.publishToKnowledge !== false) {
    const collectionId = getDouyinCollectorSettings().libraryCollectionId ?? '';
    if (!collectionId) {
      return {
        ok: false,
        phase: 'publish',
        error: '未找到默认知识库 collection，无法自动入库。',
      };
    }
    publish = await publishVideoToKnowledge(resolved.video.id, collectionId);
    if (publish && typeof publish === 'object' && 'ok' in publish && publish.ok === false) {
      return {
        ok: false,
        phase: 'publish',
        error: String('reason' in publish ? publish.reason : '入库失败'),
      };
    }
  }

  return {
    ok: true,
    video: serializeVideo(getVideoById(resolved.video.id)) ?? serializeVideo(resolved.video)!,
    transcribe,
    summary,
    publish,
  };
}

export async function resolveVideoForAi(input: ProcessVideoForAiInput): Promise<AiOutcome<{ video: VideoRow }>> {
  if (input.videoId) {
    const video = getVideoById(input.videoId);
    if (video) return { ok: true, video };
    return { ok: false, phase: 'resolve-video', error: `视频记录不存在：${input.videoId}` };
  }
  const explicitAweme = input.awemeId?.trim();
  if (explicitAweme) {
    const existing = findVideoByAwemeId(explicitAweme);
    if (existing) return { ok: true, video: existing };
    const collected = await collectVideoForAi(explicitAweme, { autoProcess: false });
    if (!collected.ok) return collected;
    const video = findVideoByAwemeId(explicitAweme);
    if (video) return { ok: true, video };
    return { ok: false, phase: 'resolve-video', error: `已尝试采集，但没有找到 aweme_id=${explicitAweme} 的视频记录。` };
  }
  if (input.input) {
    const resolved = await resolveAwemeInput(input.input);
    if (!resolved.ok) return resolved;
    const existing = findVideoByAwemeId(resolved.awemeId);
    if (existing) return { ok: true, video: existing };
    const collected = await collectVideoForAi(resolved.targetRef, { autoProcess: false });
    if (!collected.ok) return collected;
    const video = findVideoByAwemeId(resolved.awemeId);
    if (video) return { ok: true, video };
    return { ok: false, phase: 'resolve-video', error: `已尝试采集，但没有找到 aweme_id=${resolved.awemeId} 的视频记录。` };
  }
  return { ok: false, phase: 'resolve-video', error: '需要 videoId、awemeId 或抖音视频链接。' };
}

export async function ensureCreatorForAi(
  input: string,
  opts: { nickname?: string | null; cadence?: CreatorCadence | string | null } = {},
): Promise<AiOutcome<{ creator: CreatorRecord & { id: string } }>> {
  const raw = input.trim();
  if (!raw) return { ok: false, phase: 'creator-input', error: '博主输入不能为空。' };
  let parsed = parseDouyinInput(raw);
  if (parsed.kind === 'short-url') {
    const resolved = await resolveShortLink(parsed.shortToken);
    if (!resolved) {
      return { ok: false, phase: 'creator-input', error: `短链解析失败：v.douyin.com/${parsed.shortToken}` };
    }
    parsed = parseDouyinInput(resolved);
  }
  const secUid =
    parsed.kind === 'sec_uid' || parsed.kind === 'profile-url'
      ? parsed.secUid
      : null;
  if (!secUid) {
    return { ok: false, phase: 'creator-input', error: '需要博主主页链接、sec_uid 或可解析到主页的短链。' };
  }

  const existing = listCreators().find((item) => item.sec_uid === secUid);
  if (existing) return { ok: true, creator: existing as CreatorRecord & { id: string } };

  const now = new Date().toISOString();
  const store = getDouyinCollectorStore();
  const created = store.create<CreatorRecord>(COLLECTION_CREATORS, {
    sec_uid: secUid,
    uid: null,
    nickname: opts.nickname?.trim() || `博主 ${secUid.slice(0, 8)}…`,
    avatar: null,
    follow_count: null,
    cadence: normalizeCadence(opts.cadence, 'manual'),
    last_checked_at: null,
    last_failure_reason: null,
    enabled: true,
    updated_at: now,
  });
  return { ok: true, creator: created as CreatorRecord & { id: string } };
}

export function ensureKeywordForAi(
  queryRaw: string,
  opts: {
    timeWindow?: KeywordTimeWindow | string | null;
    dedupeWindowDays?: number | null;
    cadence?: CreatorCadence | string | null;
  } = {},
): AiOutcome<{ keyword: KeywordRecord & { id: string } }> {
  const query = cleanKeywordQuery(queryRaw);
  if (!query) return { ok: false, phase: 'keyword-input', error: '关键词不能为空。' };

  const existing = listKeywords().find((item) => item.query.toLowerCase() === query.toLowerCase());
  if (existing) return { ok: true, keyword: existing as KeywordRecord & { id: string } };

  const now = new Date().toISOString();
  const store = getDouyinCollectorStore();
  const created = store.create<KeywordRecord>(COLLECTION_KEYWORDS, {
    query,
    time_window: normalizeTimeWindow(opts.timeWindow),
    dedupe_window_days: normalizeDedupeWindow(opts.dedupeWindowDays),
    cadence: normalizeCadence(opts.cadence, 'manual'),
    last_checked_at: null,
    last_failure_reason: null,
    enabled: true,
    updated_at: now,
  });
  return { ok: true, keyword: created as KeywordRecord & { id: string } };
}

export async function resolveAwemeInput(input: string): Promise<AiOutcome<{ awemeId: string; targetRef: string }>> {
  const raw = input.trim();
  if (!raw) return { ok: false, phase: 'video-input', error: '视频链接或 aweme_id 不能为空。' };
  let parsed = parseDouyinInput(raw);
  if (parsed.kind === 'short-url') {
    const resolved = await resolveShortLink(parsed.shortToken);
    if (!resolved) {
      return { ok: false, phase: 'video-input', error: `短链解析失败：v.douyin.com/${parsed.shortToken}` };
    }
    parsed = parseDouyinInput(resolved);
  }
  const awemeId =
    parsed.kind === 'aweme_id' || parsed.kind === 'video-url'
      ? parsed.awemeId
      : null;
  if (!awemeId) {
    return { ok: false, phase: 'video-input', error: '需要抖音视频链接、短链或纯 aweme_id。' };
  }
  return { ok: true, awemeId, targetRef: `https://www.douyin.com/video/${awemeId}` };
}

function getVideoById(id: string): VideoRow | null {
  return getDouyinCollectorStore().get<VideoRow>(COLLECTION_VIDEOS, id);
}

function findVideoByAwemeId(awemeId: string): VideoRow | null {
  return getDouyinCollectorStore()
    .query<VideoRow>(COLLECTION_VIDEOS, { filter: { aweme_id: awemeId }, limit: 1 })
    .at(0) ?? null;
}

function listVideosByCreator(secUid: string, limit: number): VideoRow[] {
  if (!secUid) return [];
  return getDouyinCollectorStore().query<VideoRow>(COLLECTION_VIDEOS, {
    filter: { creator_ref: secUid },
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: Math.max(1, Math.min(200, limit)),
  });
}

function listVideosByKeyword(query: string, limit: number): VideoRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return getDouyinCollectorStore()
    .query<VideoRow>(COLLECTION_VIDEOS, {
      orderBy: { field: 'updated_at', direction: 'desc' },
      limit: 1000,
    })
    .filter((video) => parseVideoTags(video.tags).some((tag) => tag.toLowerCase() === needle))
    .slice(0, Math.max(1, Math.min(200, limit)));
}

async function processVideosBestEffort(
  videos: VideoRow[],
  publishToKnowledge: boolean,
): Promise<ProcessBatchResult> {
  const failures: ProcessBatchResult['failures'] = [];
  let succeeded = 0;
  const selected = videos.slice(0, 20);
  for (const video of selected) {
    try {
      const outcome = await processVideoForAi({
        videoId: video.id,
        transcribe: true,
        summarize: true,
        publishToKnowledge,
      });
      if (outcome.ok) {
        succeeded += 1;
      } else {
        failures.push({
          videoId: video.id,
          awemeId: video.aweme_id ?? null,
          phase: outcome.phase,
          error: outcome.error,
        });
      }
    } catch (err) {
      failures.push({
        videoId: video.id,
        awemeId: video.aweme_id ?? null,
        phase: 'process',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return {
    attempted: selected.length,
    succeeded,
    failed: failures.length,
    failures,
  };
}

function failedJobReason(out: { job?: CollectJobRow | null }): string | null {
  if (out.job?.status !== 'failed') return null;
  return out.job.failure_reason ?? '采集任务失败。';
}

function serializeVideo(video: VideoRow | null | undefined): DouyinAiVideo | null {
  if (!video) return null;
  return {
    id: video.id,
    aweme_id: video.aweme_id ?? null,
    title: video.title ?? null,
    creator_nickname: video.creator_nickname ?? null,
    creator_ref: video.creator_ref ?? null,
    duration_seconds: video.duration_seconds ?? null,
    transcript_status: video.transcript_status ?? null,
    library_status: video.library_status ?? null,
    library_collection_id: video.library_collection_id ?? null,
    summary: video.summary ?? null,
    cover: video.cover ?? null,
    updated_at: video.updated_at ?? null,
  };
}

function normalizeCadence(value: CreatorCadence | string | null | undefined, fallback: CreatorCadence): CreatorCadence {
  if (value === 'manual' || value === 'hourly' || value === 'daily' || value === 'weekly') return value;
  return fallback;
}

function normalizeTimeWindow(value: KeywordTimeWindow | string | null | undefined): KeywordTimeWindow {
  if (value === 'day' || value === 'week' || value === 'month' || value === 'all') return value;
  return 'week';
}

function normalizeDedupeWindow(value: number | null | undefined): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return Math.floor(numeric);
  return 30;
}

export async function getVideoMetadataForAi(input: string): Promise<AiOutcome<{ metadata: unknown }>> {
  const resolved = await resolveAwemeInput(input);
  if (!resolved.ok) return resolved;
  const outcome = await fetchVideoMetadata(resolved.awemeId);
  if (!outcome.ok) {
    return { ok: false, phase: outcome.phase, error: outcome.reason };
  }
  return { ok: true, metadata: outcome.metadata };
}

export function listRecentDouyinJobsForAi(limit = 20): CollectJobRow[] {
  return getDouyinCollectorStore().query(COLLECTION_JOBS, {
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: Math.max(1, Math.min(100, limit)),
  });
}
