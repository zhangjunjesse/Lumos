/**
 * Fire-and-forget collect starter for the progress-visible chat path.
 *
 * Closes the gap left by B-lite: douyin_enqueue_collect needs a
 * subscription record id as target_ref, but the AI only has a raw
 * keyword / profile string. This ensures the record server-side, creates
 * the job, kicks `runJob` WITHOUT awaiting it, and returns the job id
 * immediately so the AI can poll douyin_job_status and narrate progress.
 *
 * Contract note: this does NOT change douyin_search_keyword (still the
 * synchronous one-shot). It is a purely additive parallel entry point.
 * The heavy pipeline still runs in-process via the same runJob the
 * synchronous path uses — only the awaiting is dropped here.
 */

import {
  ensureCreatorForAi,
  ensureKeywordForAi,
  resolveAwemeInput,
} from './ai-tools';
import { createJob, findActiveDuplicateJob, runJob, type CreateJobInput } from './jobs';
import type { CollectJobRow } from './storage';
import type { CreatorCollectMode } from './types';

export type StartCollectKind = 'keyword' | 'creator' | 'link';

export interface StartCollectInput {
  kind: StartCollectKind;
  input: string;
  nickname?: string | null;
  cadence?: string | null;
  timeWindow?: string | null;
  dedupeWindowDays?: number | null;
  /** 元数据后是否继续跑字幕→摘要→入库；缺省 true（对齐 search_keyword）。 */
  autoProcess?: boolean;
  /** 是否把处理结果发布到默认资料库；缺省 true（对齐 MCP 工具文案）。 */
  publishToKnowledge?: boolean;
  /** creator only: recent=快速，full=长滚动尽量采全。 */
  creatorCollectMode?: CreatorCollectMode;
  /** creator only: 最大发现视频数。 */
  maxVideos?: number;
}

export type StartCollectResult =
  | { ok: true; job: CollectJobRow }
  | { ok: false; error: string; phase?: string };

/**
 * Run the job in the background. Extracted so the failure of a
 * synchronously-thrown runJob (vs. a rejected promise) can't escape and
 * crash the caller — a started job that later fails records its own
 * terminal state on the job row; the starter only owns "did it launch".
 */
function launchInBackground(jobId: string): void {
  void Promise.resolve()
    .then(() => runJob(jobId))
    .catch(() => undefined);
}

function createOrReuseJob(input: CreateJobInput): { job: CollectJobRow; deduped: boolean } {
  const duplicate = findActiveDuplicateJob(input);
  if (duplicate) return { job: duplicate, deduped: true };
  return { job: createJob(input), deduped: false };
}

export async function startCollectJob(
  req: StartCollectInput,
): Promise<StartCollectResult> {
  const input = (req.input ?? '').trim();
  if (!input) return { ok: false, error: 'input 不能为空。', phase: 'input' };

  if (req.kind === 'keyword') {
    const ensured = ensureKeywordForAi(input, {
      timeWindow: req.timeWindow,
      dedupeWindowDays: req.dedupeWindowDays,
      cadence: req.cadence,
    });
    if (!ensured.ok) return { ok: false, error: ensured.error, phase: ensured.phase };
    const { job, deduped } = createOrReuseJob({
      kind: 'keyword',
      targetRef: ensured.keyword.id,
      autoProcess: req.autoProcess,
      publishToKnowledge: req.publishToKnowledge !== false,
    });
    if (!deduped) launchInBackground(job.id);
    return { ok: true, job };
  }

  if (req.kind === 'creator') {
    const ensured = await ensureCreatorForAi(input, {
      nickname: req.nickname,
      cadence: req.cadence,
    });
    if (!ensured.ok) return { ok: false, error: ensured.error, phase: ensured.phase };
    const { job, deduped } = createOrReuseJob({
      kind: 'creator',
      targetRef: ensured.creator.id,
      autoProcess: req.autoProcess,
      publishToKnowledge: req.publishToKnowledge !== false,
      creatorCollectMode: req.creatorCollectMode,
      maxVideos: req.maxVideos,
    });
    if (!deduped) launchInBackground(job.id);
    return { ok: true, job };
  }

  // link
  const resolved = await resolveAwemeInput(input);
  if (!resolved.ok) return { ok: false, error: resolved.error, phase: resolved.phase };
  const { job, deduped } = createOrReuseJob({
    kind: 'link',
    targetRef: resolved.targetRef,
    autoProcess: req.autoProcess,
    publishToKnowledge: req.publishToKnowledge !== false,
  });
  if (!deduped) launchInBackground(job.id);
  return { ok: true, job };
}
