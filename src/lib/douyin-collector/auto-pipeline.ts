import { COLLECTION_VIDEOS } from './constants';
import { getDouyinCollectorSettings } from './settings';
import { getDouyinCollectorStore } from './storage';
import { transcribeVideoFromNative } from './transcribe';
import { publishVideoToKnowledge } from './publish';

const RUN_HISTORY_COLLECTION = 'run_history';

export interface AutoPipelineResult {
  attempted: number;
  succeeded: number;
  failed: number;
  failures: string[];
  skipped: boolean;
  skipReason?: 'empty' | 'auto_transcribe_disabled';
  autoSummarize: boolean;
  autoPublish: boolean;
  libraryCollectionId: string | null;
}

/**
 * After a collect job successfully adds new videos, optionally chain
 * through transcribe → (auto)publish per the user's settings. The publish
 * stage reuses the existing knowledge indexing / summary generation in the
 * `maybeAutoPublish` chain inside `transcribe.ts`, so we only need to
 * trigger the transcribe step here — the rest cascades automatically.
 *
 * Honest contract:
 *   - `autoTranscribe=false`: returns immediately, zero work.
 *   - Per-video failures are caught and recorded into `run_history` so
 *     the user can see which videos didn't go through. They do NOT abort
 *     the rest of the queue — one stuck video shouldn't block 29 others.
 *   - Bounded-concurrency worker pool: respects `settings.transcribeConcurrency`
 *     so 30-video creator scrapes don't serialize into a 10-minute wait.
 *     Round 12 fix: previously the loop was sequential despite a comment
 *     claiming it honored the setting.
 */
export interface AutoPipelineOpts {
  /**
   * 单条调用强制跑链路，覆盖全局 autoTranscribe 关闭（默认 false）。
   * 对齐同步 douyin_search_keyword 的 auto_process 语义：用户/AI 显式
   * 要求处理时，不被默认关闭的全局设置 gate 掉。
   */
  force?: boolean;
  /**
   * undefined=沿用全局 autoPublish；true/false=本次采集入口显式要求。
   * MCP 的 douyin_start_collect 默认 true，避免“已处理”但资料库无记录。
   */
  publishToKnowledge?: boolean;
  /** 每处理完 1 条回调（done=已完成数, total=总数），驱动实时进度。 */
  onProgress?: (done: number, total: number) => void;
}

// 单条处理硬上限：字幕抓取 + 可能的音频下载 + 云 ASR。给足余量但必须有界，
// 否则一条卡住的视频会让整个 worker 池 Promise.all 永不 resolve（用户实测
// 「卡 1/20 再无进展」的机制）。超时按失败计并继续，不静默吞。
const PER_VIDEO_TIMEOUT_MS = 4 * 60_000;

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`处理超时（>${Math.round(ms / 1000)}s）：${label}`)),
          ms,
        );
      }),
    ]);
  } finally {
    // 关键：promise 先 settle 时必须清掉定时器，否则 4min 定时器挂住事件
    // 循环（测试报 worker 不退出；生产是逐条累积的泄漏）。
    if (timer) clearTimeout(timer);
  }
}

export async function maybeRunAutoPipeline(
  videoIds: string[],
  opts: AutoPipelineOpts = {},
): Promise<AutoPipelineResult> {
  const emptyResult = (skipReason: AutoPipelineResult['skipReason']): AutoPipelineResult => ({
    attempted: 0,
    succeeded: 0,
    failed: 0,
    failures: [],
    skipped: true,
    skipReason,
    autoSummarize: false,
    autoPublish: false,
    libraryCollectionId: null,
  });
  if (videoIds.length === 0) return emptyResult('empty');
  const settings = getDouyinCollectorSettings();
  const publishToKnowledge = opts.publishToKnowledge ?? settings.autoPublish;
  if (!settings.autoTranscribe && !opts.force) {
    return {
      ...emptyResult('auto_transcribe_disabled'),
      autoSummarize: settings.autoSummarize,
      autoPublish: publishToKnowledge,
      libraryCollectionId: settings.libraryCollectionId,
    };
  }

  const store = getDouyinCollectorStore();
  let succeeded = 0;
  let done = 0;
  const total = videoIds.length;
  const failures: string[] = [];
  const concurrency = Math.max(1, Math.min(8, settings.transcribeConcurrency || 3));
  const queue = [...videoIds];

  async function worker() {
    while (queue.length > 0) {
      const videoId = queue.shift();
      if (!videoId) return;
      try {
        const r = await withTimeout(
          transcribeVideoFromNative(videoId),
          PER_VIDEO_TIMEOUT_MS,
          videoId,
        );
        if (!r.ok) {
          failures.push(r.reason ?? '抓字幕失败');
        } else if (publishToKnowledge) {
          const collectionId = settings.libraryCollectionId;
          if (!collectionId) {
            failures.push('已抓到字幕，但未设置默认资料库，无法入库。');
          } else {
            const publish = await publishVideoToKnowledge(videoId, collectionId);
            if (publish.ok) {
              succeeded += 1;
            } else {
              failures.push(publish.reason || '入库失败');
            }
          }
        } else {
          succeeded += 1;
        }
      } catch (err) {
        // 含超时：按失败计入并继续，绝不让一条卡死冻结整池。
        const reason = err instanceof Error ? err.message : String(err);
        failures.push(reason);
        // 关键：withTimeout reject 时 transcribeVideoFromNative 内部的 fetch
        // 可能仍在 await（socket 没 abort，event loop 占着）。worker 这里已经
        // 释放了，但 db 里 video 还是 transcribe.ts 一开始写的 'running'，
        // 导致用户看到永远卡在 running、且下次重跑发现状态异常无法重置。
        // 显式覆盖成 failed + 写明超时原因，让 UI 可观测、bulk-transcribe
        // 的 scope='failed' 能扫到它重跑。
        try {
          store.update(COLLECTION_VIDEOS, videoId, {
            transcript_status: 'failed',
            failure_reason: reason,
            updated_at: new Date().toISOString(),
          });
        } catch { /* 写 db 失败也不让 worker 中断 */ }
      } finally {
        done += 1;
        try {
          opts.onProgress?.(done, total);
        } catch {
          // 进度回调失败绝不能破坏 pipeline。
        }
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, videoIds.length) }, () => worker()),
  );

  // Single rolled-up run_history entry — one per pipeline batch, not one
  // per video. Keeps the run history tidy when 30 videos arrive at once.
  const distinct = Array.from(new Set(failures)).slice(0, 3);
  const status = failures.length === 0 ? 'success' : 'failed';
  const settingsSuffix = describeAutoPipelineSettings({
    autoSummarize: settings.autoSummarize,
    autoPublish: publishToKnowledge,
    libraryCollectionId: settings.libraryCollectionId,
  });
  const summary =
    failures.length === 0
      ? `自动管线：${succeeded} / ${videoIds.length} 条字幕已抓；${settingsSuffix}`
      : `自动管线：${succeeded} 成功 / ${failures.length} 失败${
          distinct.length > 0 ? `（${distinct.join('；')}）` : ''
        }；${settingsSuffix}`;
  store.create(RUN_HISTORY_COLLECTION, {
    title: '自动管线（采集后）',
    status,
    summary,
    failure_reason: status === 'failed' ? summary : null,
    updated_at: new Date().toISOString(),
  });

  // Surface the discovery: count is informational; the videos themselves
  // are already in the store with their post-pipeline state.
  void store.count(COLLECTION_VIDEOS);
  return {
    attempted: videoIds.length,
    succeeded,
    failed: failures.length,
    failures,
    skipped: false,
    autoSummarize: settings.autoSummarize,
    autoPublish: publishToKnowledge,
    libraryCollectionId: settings.libraryCollectionId,
  };
}

function describeAutoPipelineSettings(settings: {
  autoSummarize: boolean;
  autoPublish: boolean;
  libraryCollectionId: string | null;
}): string {
  const summarize = settings.autoSummarize ? '自动总结已开启' : '自动总结关闭';
  let publish = '自动入库关闭';
  if (settings.autoPublish && settings.libraryCollectionId) {
    publish = '自动入库已开启';
  } else if (settings.autoPublish && !settings.libraryCollectionId) {
    publish = '自动入库已开启但缺默认知识库';
  }
  return `${summarize}；${publish}`;
}
