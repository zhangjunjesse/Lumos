import { maybeRunAutoPipeline, type AutoPipelineResult } from './auto-pipeline';
import {
  getDouyinCollectorStore,
  type CreatorRow,
  type KeywordRow,
  type CollectJobRow,
} from './storage';
import { COLLECTION_JOBS, COLLECTION_VIDEOS } from './constants';
import type { CollectJobRecord, JobKind, JobStatus } from './types';
import { parseDouyinInput } from './parse-input';
import {
  fetchCreatorVideos,
  fetchVideoMetadata,
  resolveShortLink,
  type ScrapedVideoMetadata,
} from './scraper';
import { fetchCreatorAwemesViaBrowser } from './creator-browser-scrape';
import { fetchKeywordAwemesViaBrowser } from './keyword-browser-scrape';
import { parseVideoTags } from './parsers';
import type { CreatorRecord, KeywordRecord } from './types';
import { COLLECTION_CREATORS, COLLECTION_KEYWORDS } from './constants';

const RUN_HISTORY_COLLECTION = 'run_history';

/**
 * Bookkeeping for collect_jobs: enqueue a job, mark it running / success /
 * failed. The actual scraping (douyin MCP bridge) is not yet wired — until it
 * lands, every triggered job is closed immediately with a structured failure
 * reason rather than fake video data, per the native-app spec contract.
 */

export interface CreateJobInput {
  kind: JobKind;
  targetRef: string;
}

export function createJob(input: CreateJobInput): CollectJobRow {
  const store = getDouyinCollectorStore();
  const now = new Date().toISOString();
  return store.create<CollectJobRecord>(COLLECTION_JOBS, {
    kind: input.kind,
    target_ref: input.targetRef,
    status: 'queued',
    started_at: null,
    ended_at: null,
    failure_reason: null,
    discovered_count: 0,
    transcribed_count: 0,
    updated_at: now,
  });
}

export function markJobStatus(
  id: string,
  patch: {
    status: JobStatus;
    failureReason?: string | null;
    discoveredCount?: number;
    transcribedCount?: number;
  },
): CollectJobRow | null {
  const store = getDouyinCollectorStore();
  const now = new Date().toISOString();
  const update: Partial<CollectJobRecord> = {
    status: patch.status,
    updated_at: now,
  };
  if (patch.status === 'running') update.started_at = now;
  if (
    patch.status === 'success' ||
    patch.status === 'failed' ||
    patch.status === 'cancelled'
  ) {
    update.ended_at = now;
  }
  if (patch.failureReason !== undefined) update.failure_reason = patch.failureReason;
  if (typeof patch.discoveredCount === 'number') update.discovered_count = patch.discoveredCount;
  if (typeof patch.transcribedCount === 'number') update.transcribed_count = patch.transcribedCount;
  return store.update<CollectJobRecord>(COLLECTION_JOBS, id, update);
}

/**
 * Run a collect job. The link path now uses the public share-page scraper
 * to actually pull video metadata; creator / keyword paths still depend on
 * the MCP bridge (not yet wired) and fail with a structured reason.
 *
 * Every terminal outcome (success or failure) is mirrored into
 * `run_history` so the declarative run-history page and the IM
 * `/app douyin-collector runs` command see the same data the React UI
 * sees.
 */
export async function runJob(jobId: string): Promise<CollectJobRow | null> {
  const store = getDouyinCollectorStore();
  const job = store.get<CollectJobRecord>(COLLECTION_JOBS, jobId);
  if (!job) return null;

  markJobStatus(jobId, { status: 'running' });

  if (job.kind === 'link') {
    return await runLinkJob(jobId, job);
  }
  if (job.kind === 'creator') {
    return await runCreatorJob(jobId, job);
  }
  if (job.kind === 'keyword') {
    return await runKeywordJob(jobId, job);
  }

  const failureReason = `未知 job 类型：${String(job.kind)}`;
  const updated = markJobStatus(jobId, { status: 'failed', failureReason });
  recordRun(job, 'failed', failureReason);
  return updated;
}

/**
 * Keyword path: navigate the embedded browser to douyin's current desktop
 * search route (`/search/<query>?aid=<uuid>&type=general`) and read rendered
 * video links from the DOM after the JS feed loads.
 *
 * Honest contract:
 *   - Treats `target_ref` as the keyword id (per existing schema).
 *   - Looks up the keyword's `query` field and searches that text.
 *   - On scrape success, upserts videos and tags each new one with the
 *     keyword (via `tags` JSON) so backlog/library filters work.
 *   - On scrape failure, marks the keyword's `last_failure_reason`.
 */
async function runKeywordJob(
  jobId: string,
  job: CollectJobRow,
): Promise<CollectJobRow | null> {
  const store = getDouyinCollectorStore();
  const keyword = store.get<KeywordRecord>(COLLECTION_KEYWORDS, job.target_ref);
  if (!keyword || !keyword.query) {
    const reason = '该关键词记录不存在或没有 query。';
    const updated = markJobStatus(jobId, { status: 'failed', failureReason: reason });
    recordRun(job, 'failed', reason);
    return updated;
  }
  const query = keyword.query.trim();

  // Round 169/181: route through BrowserManager (same architectural path
  // creator scraping unblocked in Round 167). Search SSR is dead, but the
  // rendered DOM after JS-VM unpack works once cookies are injected.
  const browserOutcome = await fetchKeywordAwemesViaBrowser(query);
  if (!browserOutcome.ok || !browserOutcome.awemeIds || browserOutcome.awemeIds.length === 0) {
    const reason = browserOutcome.ok
      ? `内置浏览器加载页面成功但抓不到视频列表（可能 cookie 失效或 douyin 该页空）。`
      : (browserOutcome.reason ?? '内置浏览器调用失败');
    const fullReason = `${reason}（手动兜底：展开订阅行的「手动 ingest」面板粘抖音视频链接逐条入库）`;
    const updated = markJobStatus(jobId, { status: 'failed', failureReason: fullReason });
    store.update<KeywordRecord>(COLLECTION_KEYWORDS, keyword.id, {
      last_failure_reason: fullReason,
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    recordRun(job, 'failed', fullReason);
    return updated;
  }

  let added = 0;
  const newVideoIds: string[] = [];
  const failures: string[] = [];
  for (const awemeId of browserOutcome.awemeIds) {
    const single = await fetchVideoMetadata(awemeId);
    if (!single.ok) {
      failures.push(`${awemeId}: ${single.reason}`);
      continue;
    }
    const r = upsertVideoFromScrape(single.metadata);
    // Tag the video with the keyword (same case-insensitive merge logic
    // the legacy hashtag path used before Round 161 nuked it).
    const row = store.get<{ tags?: string }>(COLLECTION_VIDEOS, r.id);
    const existing = parseVideoTags(row?.tags);
    const lower = query.toLowerCase();
    if (!existing.some((t) => t.toLowerCase() === lower)) {
      store.update(COLLECTION_VIDEOS, r.id, {
        tags: JSON.stringify([...existing, query]),
      });
    }
    if (r.created) newVideoIds.push(r.id);
    added += 1;
  }

  const finalStatus = added > 0 ? 'success' : 'failed';
  const finalFailureReason = added === 0 && failures.length > 0 ? failures[0] : undefined;
  store.update<KeywordRecord>(COLLECTION_KEYWORDS, keyword.id, {
    last_failure_reason: finalStatus === 'success' ? null : finalFailureReason ?? '关键词搜索结果均未能读取视频元数据。',
    last_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const summary = `已采集 ${added} 条视频（关键词路径：内置浏览器；query=${query}）${
    failures.length > 0 ? ` · 跳过 ${failures.length} 条无效`: ''
  }`;
  const updated = markJobStatus(jobId, {
    status: finalStatus,
    discoveredCount: added,
    failureReason: finalFailureReason,
  });
  recordRun(job, finalStatus, summary);
  if (newVideoIds.length > 0) {
    await runAutoPipelineForJob(jobId, newVideoIds);
  }
  return updated;
}

async function runLinkJob(
  jobId: string,
  job: CollectJobRow,
): Promise<CollectJobRow | null> {
  let parsed = parseDouyinInput(job.target_ref);

  // Short links must be resolved first — follow the redirect to a canonical
  // www.douyin.com/video/<aweme_id> URL and re-parse.
  if (parsed.kind === 'short-url') {
    const resolved = await resolveShortLink(parsed.shortToken);
    if (!resolved) {
      const reason = `短链解析失败：v.douyin.com/${parsed.shortToken} 不可达或返回了非预期响应。`;
      const updated = markJobStatus(jobId, { status: 'failed', failureReason: reason });
      recordRun(job, 'failed', reason);
      return updated;
    }
    parsed = parseDouyinInput(resolved);
  }

  let awemeId: string | null = null;
  if (parsed.kind === 'aweme_id') awemeId = parsed.awemeId;
  else if (parsed.kind === 'video-url') awemeId = parsed.awemeId;

  if (!awemeId) {
    const reason = '无法从输入解析出 aweme_id；请确认是抖音视频链接或纯 aweme_id。';
    const updated = markJobStatus(jobId, { status: 'failed', failureReason: reason });
    recordRun(job, 'failed', reason);
    return updated;
  }

  const outcome = await fetchVideoMetadata(awemeId);
  if (!outcome.ok) {
    const updated = markJobStatus(jobId, {
      status: 'failed',
      failureReason: outcome.reason,
    });
    recordRun(job, 'failed', outcome.reason);
    return updated;
  }

  const { id, created } = upsertVideoFromScrape(outcome.metadata);
  const summary = `已采集 1 条视频：${outcome.metadata.title ?? outcome.metadata.awemeId}`;
  const updated = markJobStatus(jobId, {
    status: 'success',
    discoveredCount: 1,
  });
  recordRun(job, 'success', summary);
  if (created) {
    await runAutoPipelineForJob(jobId, [id]);
  }
  return updated;
}

async function runCreatorJob(
  jobId: string,
  job: CollectJobRow,
): Promise<CollectJobRow | null> {
  const store = getDouyinCollectorStore();
  const creator = store.get<CreatorRecord>(COLLECTION_CREATORS, job.target_ref);
  const secUid = creator?.sec_uid ?? null;

  if (!secUid) {
    const reason =
      '该博主没有 sec_uid（添加时输入的是昵称或短链）。请先编辑博主条目填入主页链接 / sec_uid。';
    const updated = markJobStatus(jobId, { status: 'failed', failureReason: reason });
    recordRun(job, 'failed', reason);
    return updated;
  }

  // Round 167: try the embedded BrowserManager path FIRST. iesdouyin's
  // share/user/* endpoint is JS-VM packed (Round 161); only a real
  // browser context can extract the video list. If the bridge is down
  // (e.g., running outside Electron), fall back to the legacy fetch
  // path which will surface the JS-VM signature reason honestly.
  const browserOutcome = await fetchCreatorAwemesViaBrowser(secUid);
  if (browserOutcome.ok && browserOutcome.awemeIds && browserOutcome.awemeIds.length > 0) {
    let added = 0;
    let skippedAuthorMismatch = 0;
    const newVideoIds: string[] = [];
    const failures: string[] = [];
    let firstAuthorNickname: string | null = null;
    for (const awemeId of browserOutcome.awemeIds) {
      const single = await fetchVideoMetadata(awemeId);
      if (!single.ok) {
        failures.push(`${awemeId}: ${single.reason}`);
        continue;
      }
      // douyin user pages embed Baidu/SEO-spider video links under
      // `?source=Baiduspider` etc — those are **other creators'** videos
      // douyin chose to recommend on this page. Filter by authorSecUid
      // so only the requested creator's videos land in the library.
      if (single.metadata.authorSecUid && single.metadata.authorSecUid !== secUid) {
        skippedAuthorMismatch += 1;
        continue;
      }
      // Round 176: capture the first matching video's authorNickname
      // for back-fill below. fetchCreatorAwemesViaBrowser doesn't
      // extract profile fields (nickname/avatar/follower_count); but
      // every video share-page does. Using the first scraped video's
      // metadata is the most reliable per-creator profile signal we have.
      if (!firstAuthorNickname && single.metadata.authorNickname) {
        firstAuthorNickname = single.metadata.authorNickname;
      }
      const r = upsertVideoFromScrape(single.metadata);
      if (r.created) newVideoIds.push(r.id);
      added += 1;
    }
    if (creator) {
      const creatorPatch: Partial<CreatorRecord> = {
        last_failure_reason: null,
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      // Only back-fill nickname when current value looks like a
      // placeholder ("博主 MS4xxxx…" auto-generated when user pasted
      // URL without nickname). User-typed real nicknames are sacred.
      if (
        firstAuthorNickname &&
        (!creator.nickname || creator.nickname.startsWith('博主 '))
      ) {
        creatorPatch.nickname = firstAuthorNickname;
      }
      store.update<CreatorRecord>(COLLECTION_CREATORS, creator.id, creatorPatch);
    }
    const skippedSuffix = skippedAuthorMismatch > 0 ? ` · 跳过 ${skippedAuthorMismatch} 条非该博主的相关推荐` : '';
    const summary = failures.length === 0
      ? `已采集 ${added} 条视频（内置浏览器；secUid ${secUid.slice(0, 8)}…）${skippedSuffix}`
      : `已采集 ${added} 条 / ${failures.length} 失败${skippedSuffix}（${failures.slice(0, 1).join('；')}…）`;
    const updated = markJobStatus(jobId, {
      status: failures.length === 0 || added > 0 ? 'success' : 'failed',
      discoveredCount: added,
      failureReason: failures.length > 0 && added === 0 ? failures[0] : undefined,
    });
    recordRun(job, failures.length === 0 || added > 0 ? 'success' : 'failed', summary);
    if (newVideoIds.length > 0) {
      await runAutoPipelineForJob(jobId, newVideoIds);
    }
    return updated;
  }

  const outcome = await fetchCreatorVideos(secUid);
  if (!outcome.ok) {
    // Surface BOTH why the browser path didn't take + why fetch failed,
    // so the user knows which gate is blocking them.
    const reason = browserOutcome.reason
      ? `${outcome.reason}（同时尝试内置浏览器：${browserOutcome.reason}）`
      : outcome.reason;
    const updated = markJobStatus(jobId, {
      status: 'failed',
      failureReason: reason,
    });
    if (creator) {
      store.update<CreatorRecord>(COLLECTION_CREATORS, creator.id, {
        last_failure_reason: reason,
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
    recordRun(job, 'failed', reason);
    return updated;
  }

  let added = 0;
  const newVideoIds: string[] = [];
  for (const meta of outcome.profile.videos) {
    const r = upsertVideoFromScrape(meta);
    if (r.created) newVideoIds.push(r.id);
    added += 1;
  }
  if (creator) {
    store.update<CreatorRecord>(COLLECTION_CREATORS, creator.id, {
      nickname: outcome.profile.nickname ?? creator.nickname,
      avatar: outcome.profile.avatar ?? creator.avatar ?? null,
      follow_count: outcome.profile.followerCount ?? creator.follow_count ?? null,
      last_failure_reason: null,
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  const summary = `已采集 ${added} 条视频（博主：${outcome.profile.nickname ?? secUid.slice(0, 8) + '…'}）`;
  const updated = markJobStatus(jobId, { status: 'success', discoveredCount: added });
  recordRun(job, 'success', summary);
  if (newVideoIds.length > 0) {
    await runAutoPipelineForJob(jobId, newVideoIds);
  }
  return updated;
}

/**
 * Upsert a scraped video. Returns the row id and whether the row was
 * newly created (true) or just updated (false). The auto-pipeline only
 * fires on newly-created videos to avoid re-running transcribe / publish
 * on the same video every time the patrol re-fetches the creator.
 */
function upsertVideoFromScrape(
  meta: ScrapedVideoMetadata,
): { id: string; created: boolean } {
  const store = getDouyinCollectorStore();
  const existing = store
    .query<{
      id: string;
      aweme_id?: string;
      transcript_status?: string;
    }>(COLLECTION_VIDEOS, { filter: { aweme_id: meta.awemeId } })
    .at(0);
  const now = new Date().toISOString();
  const subtitleSource = meta.nativeSubtitleUrls.length > 0 ? 'native' : 'none';
  const durationBucket =
    !meta.duration ? 'short'
      : meta.duration < 60 ? 'short'
        : meta.duration < 600 ? 'medium'
          : 'long';
  const payload: {
    aweme_id: string;
    creator_ref: string | null;
    creator_nickname: string | null;
    title: string | null;
    cover: string | null;
    duration_seconds: number;
    duration_bucket: string;
    language: string;
    subtitle_source?: string;
    native_subtitle_urls: string | null;
    play_addr_urls: string | null;
    updated_at: string;
  } = {
    aweme_id: meta.awemeId,
    creator_ref: meta.authorSecUid ?? null,
    creator_nickname: meta.authorNickname ?? null,
    title: meta.title ?? null,
    cover: meta.cover ?? null,
    duration_seconds: meta.duration ?? 0,
    duration_bucket: durationBucket,
    language: 'zh-CN',
    native_subtitle_urls:
      meta.nativeSubtitleUrls.length > 0 ? JSON.stringify(meta.nativeSubtitleUrls) : null,
    play_addr_urls:
      meta.playAddrUrls.length > 0 ? JSON.stringify(meta.playAddrUrls) : null,
    updated_at: now,
  };
  if (!existing || existing.transcript_status !== 'success') {
    payload.subtitle_source = subtitleSource;
  }
  if (existing) {
    // Don't clobber transcript_status / library_status / summary / tags /
    // chapters / collection / notes on re-collect — those are downstream
    // user / pipeline state. Only refresh metadata (title / cover / urls).
    store.update(COLLECTION_VIDEOS, existing.id, payload);
    return { id: existing.id, created: false };
  }
  const created = store.create(COLLECTION_VIDEOS, {
    ...payload,
    // Round 165: explicit created_at in JSON so the "近 7 天采集" backlog
    // chip (countLibraryBacklog filters on this field) actually matches.
    // Pre-fix the JSON column was empty → Date.parse('') is NaN →
    // recent7d permanently stuck at 0. We could read the DB-level
    // created_at column instead but that requires a query schema change;
    // setting it on the row is simpler and consistent with updated_at.
    created_at: now,
    transcript_status: 'pending',
    summary: null,
    tags: null,
    chapters: null,
    library_status: 'unprocessed',
    library_collection_id: null,
    notes: null,
    failure_reason: null,
  });
  return { id: created.id, created: true };
}

function recordRun(
  job: CollectJobRow,
  status: 'success' | 'failed',
  summary: string,
): void {
  const store = getDouyinCollectorStore();
  const targetLabel =
    job.kind === 'creator'
      ? `博主 ${job.target_ref}`
      : job.kind === 'keyword'
        ? `关键词 ${job.target_ref}`
        : `链接 ${job.target_ref.slice(0, 64)}`;
  store.create(RUN_HISTORY_COLLECTION, {
    title: `采集任务：${targetLabel}`,
    status,
    summary,
    failure_reason: status === 'failed' ? summary : null,
    updated_at: new Date().toISOString(),
  });
}

async function runAutoPipelineForJob(
  jobId: string,
  videoIds: string[],
): Promise<AutoPipelineResult | null> {
  if (videoIds.length === 0) return null;
  const result = await maybeRunAutoPipeline(videoIds);
  if (result && !result.skipped) {
    updateJobTranscribedCount(jobId, result.succeeded);
  }
  return result ?? null;
}

function updateJobTranscribedCount(jobId: string, count: number): CollectJobRow | null {
  const store = getDouyinCollectorStore();
  return store.update<CollectJobRecord>(COLLECTION_JOBS, jobId, {
    transcribed_count: count,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Cancel any queued / running collect_jobs that target the given parent
 * (a specific creator or keyword id). Called from the parent's DELETE
 * route so the runner doesn't pick up the job afterward and confusingly
 * report "该博主没有 sec_uid" — the parent is gone, not malformed.
 *
 * Honest contract:
 *   - Returns the count of jobs cancelled so the caller can audit.
 *   - Cancellation is bookkeeping-only here; the in-flight `runJob` (if
 *     any) holds its own reference to job/parent and may still write a
 *     final terminal status. The cancelled-status it overwrites isn't
 *     a problem because the user already knows the parent is gone.
 *   - Idempotent — running on a parent with no pending jobs is a no-op.
 *
 * Per CLAUDE.md: "删除任务必须先取消该任务正在运行的 run, 再删除可见
 * 记录". Same pattern applied to local sub-tasks.
 */
export function cancelPendingJobsForTarget(
  kind: JobKind,
  targetRef: string,
  reason = '父订阅已删除，跳过此采集任务。',
): number {
  const store = getDouyinCollectorStore();
  const pending = store.query<CollectJobRecord>(COLLECTION_JOBS, {
    filter: { kind, target_ref: targetRef },
  });
  let count = 0;
  for (const job of pending) {
    if (job.status === 'queued' || job.status === 'running') {
      markJobStatus(job.id, { status: 'cancelled', failureReason: reason });
      count += 1;
    }
  }
  return count;
}

export function describeJobTarget(
  job: CollectJobRow,
  creators: CreatorRow[],
  keywords: KeywordRow[],
): string {
  if (job.kind === 'creator') {
    const c = creators.find((row) => row.id === job.target_ref);
    return c ? `博主 · ${c.nickname}` : `博主 · ${job.target_ref.slice(0, 8)}…`;
  }
  if (job.kind === 'keyword') {
    const k = keywords.find((row) => row.id === job.target_ref);
    return k ? `关键词 · ${k.query}` : `关键词 · ${job.target_ref.slice(0, 12)}…`;
  }
  return `链接 · ${job.target_ref.slice(0, 32)}`;
}
