import { COLLECTION_VIDEOS } from './constants';
import { getDouyinCollectorSettings } from './settings';
import { getDouyinCollectorStore } from './storage';
import { transcribeVideoFromNative } from './transcribe';

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
export async function maybeRunAutoPipeline(videoIds: string[]): Promise<AutoPipelineResult> {
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
  if (!settings.autoTranscribe) {
    return {
      ...emptyResult('auto_transcribe_disabled'),
      autoSummarize: settings.autoSummarize,
      autoPublish: settings.autoPublish,
      libraryCollectionId: settings.libraryCollectionId,
    };
  }

  const store = getDouyinCollectorStore();
  let succeeded = 0;
  const failures: string[] = [];
  const concurrency = Math.max(1, Math.min(8, settings.transcribeConcurrency || 3));
  const queue = [...videoIds];

  async function worker() {
    while (queue.length > 0) {
      const videoId = queue.shift();
      if (!videoId) return;
      try {
        const r = await transcribeVideoFromNative(videoId);
        if (r.ok) succeeded += 1;
        else failures.push(r.reason ?? '抓字幕失败');
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
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
  const settingsSuffix = describeAutoPipelineSettings(settings);
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
    autoPublish: settings.autoPublish,
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
