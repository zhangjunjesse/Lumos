import { maybeRunAutoPipeline, type AutoPipelineResult } from './auto-pipeline';
import {
  getDouyinCollectorStore,
  type CreatorRow,
  type KeywordRow,
  type CollectJobRow,
} from './storage';
import { COLLECTION_JOBS, COLLECTION_VIDEOS, DOUYIN_COLLECTOR_APP_ID } from './constants';
import { isRunCancelled, clearRunCancellation } from '@/lib/app/runtime/run-control';
import type { CollectJobRecord, CreatorCollectMode, JobKind, JobStatus } from './types';
import { getAwemeId, parseDouyinInput } from './parse-input';
import { describeUnsupportedInput } from './input-diagnosis';
import { fetchAwemeContentKind } from './note-scraper';
import { ingestNote } from './note-ingest';
import {
  fetchCreatorVideos,
  resolveShortLink,
  type ScrapedVideoMetadata,
} from './scraper';
import { fetchCreatorAwemesViaBrowser } from './creator-browser-scrape';
import { fetchKeywordAwemesViaBrowser } from './keyword-browser-scrape';
import { fetchVideoMetadataResilient } from './video-metadata-resilient';
import { reportJobProgress } from './job-progress';
import { parseVideoTags } from './parsers';
import type { CreatorRecord, KeywordRecord } from './types';
import { COLLECTION_CREATORS, COLLECTION_KEYWORDS } from './constants';
import { getDouyinCollectorSettings } from './settings';

const RUN_HISTORY_COLLECTION = 'run_history';

/**
 * Back-fill failures split into two honest buckets so the job summary
 * tells the user *why* videos didn't land:
 *   - 风控 (`phase:'risk'`): douyin rate-limit skeleton — recoverable,
 *     worth a re-run or a logged-in 采集浏览器.
 *   - 无效: genuinely deleted / private / region-locked — not coming back.
 */
export function backfillFailureSuffix(riskCount: number, otherCount: number): string {
  const parts: string[] = [];
  if (riskCount > 0) {
    parts.push(`${riskCount} 条被抖音风控（限流骨架页，稍后重跑失败或换已登录采集浏览器）`);
  }
  if (otherCount > 0) parts.push(`${otherCount} 条无效（已删除 / 私密 / 地区受限）`);
  return parts.length > 0 ? ` · ${parts.join(' · ')}` : '';
}

export function backfillFailureReason(
  riskCount: number,
  otherCount: number,
  sample?: string,
): string {
  if (riskCount > 0 && otherCount === 0) {
    return `本批 ${riskCount} 条全部被抖音风控（返回限流骨架页）；点「重跑失败」稍后再试，或在「设置 → 采集浏览器」选一个已登录上下文重采。`;
  }
  if (riskCount > 0) {
    return `${riskCount} 条被风控、${otherCount} 条无效；风控部分稍后重跑或换已登录采集浏览器。`;
  }
  return sample ?? '搜索结果均未能读取视频元数据。';
}

/**
 * Bookkeeping for collect_jobs: enqueue a job, mark it running / success /
 * failed. The actual scraping (douyin MCP bridge) is not yet wired — until it
 * lands, every triggered job is closed immediately with a structured failure
 * reason rather than fake video data, per the native-app spec contract.
 */

export interface CreateJobInput {
  kind: JobKind;
  targetRef: string;
  /** 元数据后是否继续跑字幕→摘要→入库；缺省 true。 */
  autoProcess?: boolean;
  /** undefined=沿用全局设置；true/false=本次 job 显式入库语义。 */
  publishToKnowledge?: boolean;
  /** 博主采集模式：recent=快速，full=长滚动尽量采全。 */
  creatorCollectMode?: CreatorCollectMode;
  /** 博主采集最多发现多少条视频。 */
  maxVideos?: number;
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
    auto_process: input.autoProcess !== false,
    publish_to_knowledge: input.publishToKnowledge,
    ...(input.creatorCollectMode ? { creator_collect_mode: input.creatorCollectMode } : {}),
    ...(typeof input.maxVideos === 'number' ? { max_videos: input.maxVideos } : {}),
    updated_at: now,
  });
}

export function findActiveDuplicateJob(input: CreateJobInput): CollectJobRow | null {
  if (!getDouyinCollectorSettings().dedupeCollect) return null;
  const store = getDouyinCollectorStore();
  const mode = input.creatorCollectMode ?? 'recent';
  const maxVideos = typeof input.maxVideos === 'number' ? Math.floor(input.maxVideos) : null;
  const autoProcess = input.autoProcess !== false;
  const publishToKnowledge = input.publishToKnowledge;
  const candidates = store.query<CollectJobRecord>(COLLECTION_JOBS, {
    filter: { kind: input.kind, target_ref: input.targetRef },
    orderBy: { field: 'updated_at', direction: 'desc' },
    limit: 20,
  });
  return candidates.find((job) => {
    if (job.status !== 'queued' && job.status !== 'running') return false;
    if ((job.auto_process !== false) !== autoProcess) return false;
    if (job.publish_to_knowledge !== publishToKnowledge) return false;
    if (input.kind !== 'creator') return true;
    const jobMode = job.creator_collect_mode ?? 'recent';
    const jobMaxVideos = typeof job.max_videos === 'number' ? Math.floor(job.max_videos) : null;
    return jobMode === mode && jobMaxVideos === maxVideos;
  }) ?? null;
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

  try {
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
  } finally {
    // Run 进入终态后清理 cancellation flag, 防 Set 长期堆积。下次同 id 的
    // run(理论不应该, 但稳一点)不会被旧 flag 误杀。
    clearRunCancellation(DOUYIN_COLLECTOR_APP_ID, jobId);
  }
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

  reportJobProgress(jobId, {
    phase: 'discovering',
    message: `正在抖音搜索"${query}"，打开页面发现视频列表…`,
  });
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
  let riskCount = 0;
  const processVideoIds: string[] = [];
  const failures: string[] = [];
  const total = browserOutcome.awemeIds.length;
  reportJobProgress(jobId, {
    phase: 'backfilling',
    total,
    processed: 0,
    message: `发现 ${total} 条视频，正在补全"${query}"的元数据…`,
  });
  let processed = 0;
  for (const awemeId of browserOutcome.awemeIds) {
    if (isRunCancelled(DOUYIN_COLLECTOR_APP_ID, jobId)) break;
    // Resilient back-fill: paced anonymous HTTP, with a logged-in
    // browser retry when douyin answers the rate-limit skeleton.
    const single = await fetchVideoMetadataResilient(awemeId);
    processed += 1;
    if (!single.ok) {
      if (single.phase === 'risk') riskCount += 1;
      failures.push(`${awemeId}: ${single.reason}`);
      reportJobProgress(jobId, { processed, added, risk: riskCount, message: '' });
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
    if (shouldProcessVideoForJob(r.created, job)) processVideoIds.push(r.id);
    added += 1;
    reportJobProgress(jobId, { processed, added, risk: riskCount, message: '' });
  }

  const otherCount = failures.length - riskCount;
  const metadataOk = added > 0;
  // 关键修复：元数据成功且后面要跑 pipeline 时，job 必须保持非终态，
  // 由 runAutoPipelineForJob 写诚实终态——杜绝「先标 success 再处理」的静默失败。
  const willProcess = metadataOk && processVideoIds.length > 0 && job.auto_process !== false;
  const finalStatus = metadataOk ? 'success' : 'failed';
  reportJobProgress(jobId, {
    phase: willProcess ? 'processing' : metadataOk ? 'done' : 'failed',
    processed: total,
    added,
    risk: riskCount,
    skipped: otherCount,
    message: willProcess
      ? `元数据补全完成（入库 ${added}、风控 ${riskCount}），正在后台抓字幕/总结/入库…`
      : metadataOk
        ? `仅采集元数据 ${added} 条（未要求 auto_process 或无新视频，未抓字幕/入库）。`
        : '',
  });
  const finalFailureReason =
    added === 0 && failures.length > 0
      ? backfillFailureReason(riskCount, otherCount, failures[0])
      : undefined;
  store.update<KeywordRecord>(COLLECTION_KEYWORDS, keyword.id, {
    last_failure_reason: metadataOk ? null : finalFailureReason ?? '关键词搜索结果均未能读取视频元数据。',
    last_checked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  const summary = `已采集 ${added} 条视频（关键词路径：内置浏览器；query=${query}）${
    backfillFailureSuffix(riskCount, otherCount)
  }`;
  // willProcess 时保持 running；终态与 run_history 由 pipeline 链路负责。
  const updated = markJobStatus(jobId, {
    status: willProcess ? 'running' : finalStatus,
    discoveredCount: added,
    failureReason: willProcess ? undefined : finalFailureReason,
  });
  if (!willProcess) recordRun(job, finalStatus, summary);
  if (processVideoIds.length > 0) {
    await runAutoPipelineForJob(jobId, processVideoIds, {
      force: job.auto_process !== false,
      publishToKnowledge: job.publish_to_knowledge,
    });
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

  const awemeId = getAwemeId(parsed);

  if (!awemeId) {
    const reason = describeUnsupportedInput(parsed).message;
    const updated = markJobStatus(jobId, { status: 'failed', failureReason: reason });
    recordRun(job, 'failed', reason);
    return updated;
  }

  // 内容类型:链接里带了就直接用;裸 aweme_id 看不出来(图文和视频共用同一套
  // ID 体系),只能抓一次详情探一下。探不出来时按视频走 —— 视频那条链有完整的
  // 风控重试,失败了也能给出准确原因(#55)。
  const contentKind = parsed.kind === 'aweme' && parsed.contentKind
    ? parsed.contentKind
    : await fetchAwemeContentKind(awemeId);

  if (contentKind === 'note') {
    return runNoteLinkJob(jobId, job, awemeId);
  }

  // 用 resilient 链而非裸 fetchVideoMetadata: anonymous fetch + pacer →
  // risk 时 browser fetch share page → 还 risk 时浏览器 navigate /video/<id>。
  // link 单条采集是用户最常手动触发的入口, 必须能挺过抖音风控骨架页。
  const outcome = await fetchVideoMetadataResilient(awemeId);
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
  if (shouldProcessVideoForJob(created, job)) {
    await runAutoPipelineForJob(jobId, [id], {
      force: job.auto_process !== false,
      publishToKnowledge: job.publish_to_knowledge,
    });
  }
  return updated;
}

/** 图文单条采集。和视频走同一套 job 状态机,只是抓取与取字的实现不同(#55)。 */
async function runNoteLinkJob(
  jobId: string,
  job: CollectJobRow,
  awemeId: string,
): Promise<CollectJobRow | null> {
  const outcome = await ingestNote(awemeId);
  if (!outcome.ok || !outcome.videoId) {
    const reason = outcome.reason ?? '图文采集失败。';
    const updated = markJobStatus(jobId, { status: 'failed', failureReason: reason });
    recordRun(job, 'failed', reason);
    return updated;
  }

  const updated = markJobStatus(jobId, { status: 'success', discoveredCount: 1 });
  recordRun(job, 'success', outcome.summary ?? '已采集 1 条图文');

  if (shouldProcessVideoForJob(outcome.created ?? false, job)) {
    // 和视频走同一条自动处理链。文字在 ingestNote 里已经存进 transcripts 了,
    // transcribeVideoFromNative 的幂等闸会直接返回它,不会去抓根本不存在的字幕。
    await runAutoPipelineForJob(jobId, [outcome.videoId], {
      force: job.auto_process !== false,
      publishToKnowledge: job.publish_to_knowledge,
    });
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
    // New subscriptions always resolve sec_uid up front (see
    // resolveCreatorInput). This path only fires for legacy rows added
    // before that gate existed — point users at the only recovery move:
    // delete and re-add with a proper profile link.
    const reason = '该博主缺 sec_uid（旧版残留记录）。请删除该订阅，再重新粘贴博主主页链接添加。';
    const updated = markJobStatus(jobId, { status: 'failed', failureReason: reason });
    recordRun(job, 'failed', reason);
    return updated;
  }

  reportJobProgress(jobId, {
    phase: 'discovering',
    message:
      job.creator_collect_mode === 'full'
        ? '正在长滚动博主主页，尽量发现全部视频列表…'
        : '正在打开博主主页，发现视频列表…',
  });
  // Round 167: try the embedded BrowserManager path FIRST. iesdouyin's
  // share/user/* endpoint is JS-VM packed (Round 161); only a real
  // browser context can extract the video list. If the bridge is down
  // (e.g., running outside Electron), fall back to the legacy fetch
  // path which will surface the JS-VM signature reason honestly.
  const browserOutcome = await fetchCreatorAwemesViaBrowser(secUid, {
    mode: job.creator_collect_mode === 'full' ? 'full' : 'recent',
    maxVideos: typeof job.max_videos === 'number' ? job.max_videos : undefined,
  });
  if (browserOutcome.ok && browserOutcome.awemeIds && browserOutcome.awemeIds.length > 0) {
    let added = 0;
    let riskCount = 0;
    let skippedAuthorMismatch = 0;
    let skippedExisting = 0;
    const dedupeCollect = getDouyinCollectorSettings().dedupeCollect;
    const processVideoIds: string[] = [];
    const failures: string[] = [];
    let firstAuthorNickname: string | null = null;
    const expectedCreatorNickname = normalizeCreatorNicknameForMatch(
      creator && !creator.nickname.startsWith('博主 ') ? creator.nickname : null,
    );
    const total = browserOutcome.awemeIds.length;
    let processed = 0;
    reportJobProgress(jobId, {
      phase: 'backfilling',
      total,
      processed: 0,
      message: `发现 ${total} 条视频，正在补全博主视频元数据…`,
    });
    let retranscribedExisting = 0;
    for (const awemeId of browserOutcome.awemeIds) {
      // 协作式取消: cancel API 调 markRunCancelled 后, 循环顶部 check 退出。
      // 不能 abort 已经发出去的 fetch socket, 但能让 worker 立刻停下不再发新
      // 请求, 也不再 navigate 新 tab。详见 lib/app/runtime/run-control.ts。
      if (isRunCancelled(DOUYIN_COLLECTOR_APP_ID, jobId)) break;
      // dedupe 分支：之前这里无条件跳过任何 existing 视频，导致用户在 UI
      // 上点「采集」时，38 条历史里 17 条字幕失败的也不会再尝试——出现
      // 「成功 38 / 转写 0」的静默失败。新语义：只跳过转写已成功的；其余
      // 状态（pending/failed/null）落入下面的 fetchVideoMetadataResilient
      // 重抓 + pipeline 重跑路径，因为旧元数据可能就是风控骨架污染版。
      let mustRetranscribeExisting = false;
      if (dedupeCollect) {
        const existing = findExistingVideoByAwemeId(awemeId);
        if (existing?.creator_ref === secUid) {
          const needsRetranscribe =
            job.auto_process !== false &&
            existing.transcript_status !== 'success';
          if (!needsRetranscribe) {
            processed += 1;
            skippedExisting += 1;
            if (shouldProcessVideoForJob(false, job)) {
              processVideoIds.push(existing.id);
            }
            reportJobProgress(jobId, {
              processed,
              added,
              risk: riskCount,
              skipped: skippedExisting + skippedAuthorMismatch,
              message: '',
            });
            continue;
          }
          mustRetranscribeExisting = true;
        }
      }
      // Resilient back-fill: paced anonymous HTTP, with a logged-in
      // browser retry when douyin answers the rate-limit skeleton.
      const single = await fetchVideoMetadataResilient(awemeId);
      processed += 1;
      if (!single.ok) {
        if (single.phase === 'risk') riskCount += 1;
        failures.push(`${awemeId}: ${single.reason}`);
        reportJobProgress(jobId, { processed, added, risk: riskCount, message: '' });
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
      // metadata 没 authorSecUid 时, fetchVideoMetadataResilient 拿回的多半
      // 是抖音风控骨架页 (anti-bot 拒返真实元数据). 这条 awemeId 是从
      // /user/<secUid> 主页 DOM 爬来的, scrape script 已经滤掉了
      // ?source=Baiduspider 这类显式推荐链接, 因此默认归属本人——之前
      // 严格要求 nickname 匹配才放行, 在博主作品数 >= 100+ 的场景下会被
      // 风控扫一大片, 实测 178 条作品里 114 条因此丢失. 仅当 metadata
      // 有 authorNickname 且明确对不上 expectedCreatorNickname 时才滤,
      // metadata 完全空就按 page 来源信任.
      const authorNickname = normalizeCreatorNicknameForMatch(single.metadata.authorNickname);
      if (!single.metadata.authorSecUid && expectedCreatorNickname) {
        if (authorNickname && authorNickname !== expectedCreatorNickname) {
          skippedAuthorMismatch += 1;
          continue;
        }
      }
      const verifiedMetadata: ScrapedVideoMetadata = {
        ...single.metadata,
        authorSecUid: single.metadata.authorSecUid ?? secUid,
      };
      // Round 176: capture the first matching video's authorNickname
      // for back-fill below. fetchCreatorAwemesViaBrowser doesn't
      // extract profile fields (nickname/avatar/follower_count); but
      // every video share-page does. Using the first scraped video's
      // metadata is the most reliable per-creator profile signal we have.
      if (!firstAuthorNickname && verifiedMetadata.authorNickname) {
        firstAuthorNickname = verifiedMetadata.authorNickname;
      }
      const r = upsertVideoFromScrape(verifiedMetadata);
      // mustRetranscribeExisting 是 dedupe 分支判定要重跑的 existing 视频；
      // 已经在上面 fetch + upsert 刷新过元数据，直接入 pipeline 不再走
      // shouldProcessVideoForJob 的 publish_to_knowledge 门禁（那扇门是
      // 给「新增视频」用的，不适合「修复污染元数据」语义）。
      if (mustRetranscribeExisting || shouldProcessVideoForJob(r.created, job)) {
        processVideoIds.push(r.id);
      }
      if (mustRetranscribeExisting) {
        retranscribedExisting += 1;
      } else {
        added += 1;
      }
      reportJobProgress(jobId, { processed, added, risk: riskCount, message: '' });
    }
    const otherCount = failures.length - riskCount;
    const relevantCount = added + skippedExisting + retranscribedExisting;
    const terminalStatus: 'success' | 'failed' = relevantCount > 0 ? 'success' : 'failed';
    const finalFailureReason =
      terminalStatus === 'failed'
        ? creatorZeroCollectFailureReason({
            total,
            skippedAuthorMismatch,
            riskCount,
            otherCount,
            sampleFailure: failures[0],
          })
        : undefined;
    const willProcess = processVideoIds.length > 0 && job.auto_process !== false;
    reportJobProgress(jobId, {
      phase: willProcess ? 'processing' : terminalStatus === 'success' ? 'done' : 'failed',
      processed: total,
      added,
      risk: riskCount,
      skipped: skippedExisting + skippedAuthorMismatch + (failures.length - riskCount),
      message:
        willProcess
          ? `元数据补全完成（新增/更新 ${added}、重跑 ${retranscribedExisting}、已跳过 ${skippedExisting}、风控 ${riskCount}），后续抓字幕/总结/入库在后台继续…`
          : terminalStatus === 'success'
            ? `采集完成：新增/更新 ${added} 条，跳过 ${skippedExisting} 条已转写视频。`
            : finalFailureReason ?? '',
    });
    if (creator) {
      const creatorPatch: Partial<CreatorRecord> = {
        last_failure_reason: terminalStatus === 'success' ? null : finalFailureReason,
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
    const skippedParts: string[] = [];
    if (skippedExisting > 0) skippedParts.push(`跳过 ${skippedExisting} 条已转写视频`);
    if (retranscribedExisting > 0) {
      skippedParts.push(`重跑 ${retranscribedExisting} 条之前字幕未成功的视频`);
    }
    if (skippedAuthorMismatch > 0) skippedParts.push(`跳过 ${skippedAuthorMismatch} 条非该博主的相关推荐`);
    const skippedSuffix = skippedParts.length > 0 ? ` · ${skippedParts.join(' · ')}` : '';
    const summary =
      terminalStatus === 'success'
        ? failures.length === 0
          ? `已采集 ${added} 条视频（内置浏览器；secUid ${secUid.slice(0, 8)}…）${skippedSuffix}`
          : `已采集 ${added} 条${skippedSuffix}${backfillFailureSuffix(riskCount, otherCount)}`
        : finalFailureReason ?? '本次博主采集没有落下任何视频。';
    const updated = markJobStatus(jobId, {
      status: terminalStatus,
      discoveredCount: relevantCount,
      failureReason: finalFailureReason,
    });
    recordRun(job, terminalStatus, summary);
    if (processVideoIds.length > 0) {
      await runAutoPipelineForJob(jobId, processVideoIds, {
        force: job.auto_process !== false,
        publishToKnowledge: job.publish_to_knowledge,
      });
    }
    return updated;
  }

  const outcome = await fetchCreatorVideos(secUid);
  if (!outcome.ok) {
    // Surface BOTH why the browser path didn't take + why fetch failed,
    // so the user knows which gate is blocking them.
    const reason = browserOutcome.reason
      ? `${browserOutcome.reason}（纯 fetch 兜底也失败：${outcome.reason}）`
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
  const processVideoIds: string[] = [];
  for (const meta of outcome.profile.videos) {
    const r = upsertVideoFromScrape(meta);
    if (shouldProcessVideoForJob(r.created, job)) processVideoIds.push(r.id);
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
  if (added === 0) {
    const reason = '纯 fetch 兜底返回了博主信息，但没有任何视频列表；抖音接口可能仍被反爬或该账号作品不可见。';
    const updated = markJobStatus(jobId, {
      status: 'failed',
      discoveredCount: 0,
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

  const updated = markJobStatus(jobId, { status: 'success', discoveredCount: added });
  recordRun(job, 'success', summary);
  if (processVideoIds.length > 0) {
    await runAutoPipelineForJob(jobId, processVideoIds, {
      force: job.auto_process !== false,
      publishToKnowledge: job.publish_to_knowledge,
    });
  }
  return updated;
}

function normalizeCreatorNicknameForMatch(value: string | null | undefined): string | null {
  const normalized = value
    ?.trim()
    .replace(/\s+/g, '')
    .replace(/^@+/, '');
  return normalized || null;
}

function creatorZeroCollectFailureReason(input: {
  total: number;
  skippedAuthorMismatch: number;
  riskCount: number;
  otherCount: number;
  sampleFailure?: string;
}): string {
  const parts: string[] = [];
  if (input.skippedAuthorMismatch > 0) {
    parts.push(`抓到 ${input.skippedAuthorMismatch} 条非该博主的相关推荐，已过滤`);
  }
  if (input.riskCount > 0 || input.otherCount > 0) {
    parts.push(backfillFailureReason(input.riskCount, input.otherCount, input.sampleFailure));
  }
  if (parts.length > 0) {
    return `本次没有采到目标博主作品（页面候选 ${input.total} 条，${parts.join('；')}）。请确认采集浏览器当前打开的是该博主作品页，能看到作品列表并可继续向下加载。`;
  }
  return `浏览器采集脚本运行完成，但没有落下任何目标博主视频（页面候选 ${input.total} 条，新增/已采集均为 0）。请确认采集浏览器当前打开的是该博主作品页，能看到作品列表并可继续向下加载。`;
}

function findExistingVideoByAwemeId(
  awemeId: string,
): {
  id: string;
  aweme_id?: string;
  creator_ref?: string | null;
  transcript_status?: string | null;
} | null {
  const store = getDouyinCollectorStore();
  return store.query<{
    id: string;
    aweme_id?: string;
    creator_ref?: string | null;
    transcript_status?: string | null;
  }>(COLLECTION_VIDEOS, {
    filter: { aweme_id: awemeId },
    limit: 1,
  }).at(0) ?? null;
}

/**
 * Upsert a scraped video. Returns the row id and whether the row was
 * newly created (true) or just updated (false). Most jobs only auto-process
 * newly-created videos to avoid re-running transcribe / publish on every
 * patrol; explicit publish-to-knowledge jobs may backfill existing videos.
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

function shouldProcessVideoForJob(created: boolean, job: CollectJobRow): boolean {
  if (job.auto_process === false) return false;
  if (created) return true;
  // Existing rows are normally left alone so patrols don't repeatedly
  // transcribe old videos. The progress-visible AI/MCP path explicitly sets
  // publish_to_knowledge=true, so reruns can backfill a missing knowledge item.
  return job.publish_to_knowledge === true;
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

/**
 * 元数据入库后跑「字幕→摘要→入库」并**中心化诚实终态**：所有 kind 共用，
 * 杜绝「pipeline 没真正成功却留 success」的静默失败，并把处理阶段逐条进度
 * 推给 job-progress（修复 processing 空转、卡 1/20 无反馈）。
 */
async function runAutoPipelineForJob(
  jobId: string,
  videoIds: string[],
  opts: { force: boolean; publishToKnowledge?: boolean },
): Promise<AutoPipelineResult | null> {
  if (videoIds.length === 0) return null;
  const total = videoIds.length;
  const result = await maybeRunAutoPipeline(videoIds, {
    force: opts.force,
    publishToKnowledge: opts.publishToKnowledge,
    onProgress: (done) =>
      reportJobProgress(jobId, { phase: 'processing', processed: done, total, message: '' }),
  });
  // 防御：maybeRunAutoPipeline 实际总返回结果，但测试会 mock 成 undefined，
  // 且历史契约允许 null —— 拿不到结果就不臆断终态，原样返回。
  if (!result) return null;
  if (!result.skipped) {
    updateJobTranscribedCount(jobId, result.succeeded);
  }

  if (result.skipped) {
    // 未强制且全局自动处理关闭 → 按设计只采元数据；如实标注，不算失败。
    reportJobProgress(jobId, {
      phase: 'done',
      message:
        result.skipReason === 'auto_transcribe_disabled'
          ? '仅采集了元数据：未要求 auto_process 且全局自动处理关闭（字幕/摘要/入库未运行）。'
          : '',
    });
    return result;
  }
  if (result.succeeded === 0) {
    // 关键：有视频却 0 条成功 = 静默失败的根，必须把 job 写成 failed。
    const detail = result.failures.slice(0, 2).join('；') || '未知原因';
    const reason = `元数据已入库，但字幕/摘要/入库全部失败（${result.failed} 条）：${detail}`;
    markJobStatus(jobId, { status: 'failed', failureReason: reason, transcribedCount: 0 });
    reportJobProgress(jobId, { phase: 'failed', message: reason });
  } else {
    const msg =
      result.failed > 0
        ? `完成：${result.succeeded} 条${result.autoPublish ? '已抓字幕入库' : '已抓字幕'} / ${result.failed} 条失败`
        : `完成：${result.succeeded} 条${result.autoPublish ? '已抓字幕并入库' : '已抓字幕'}`;
    markJobStatus(jobId, {
      status: 'success',
      transcribedCount: result.succeeded,
      failureReason: result.failed > 0 ? msg : null,
    });
    reportJobProgress(jobId, { phase: 'done', added: result.succeeded, message: msg });
  }
  return result;
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
