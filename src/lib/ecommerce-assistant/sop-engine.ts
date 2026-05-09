import { generateImages } from '@/lib/image';
import type { GenerateImagesParams } from '@/lib/image';
import type { AppDataStore } from '@/lib/app/runtime/data-store';

import {
  appendOutput,
  getInput,
  patchJob,
  readReferenceImagePaths,
  upsertBrief,
  type ProductInputRow,
} from './storage';
import {
  evaluateCutout,
  evaluateFinal,
  identifyProductBrief,
  planDirections,
  scoreScenes,
} from './llm-client';
import {
  BRIEF_IDENTIFY_PROMPT,
  CUTOUT_FALLBACK_HINT,
  CUTOUT_PROMPT,
  CUTOUT_QC_PROMPT,
  FALLBACK_PROMPT,
  FINAL_QC_PROMPT,
  SYSTEM_PROMPT,
  buildFinalRefinePrompt,
  buildPlanDirectionsPrompt,
  buildSceneGenerationPrompt,
  buildScoringPrompt,
} from './prompts';
import { SOP_LIMITS } from './constants';
import type {
  DirectionPlan,
  ImageJobRecord,
  ImageJobStatus,
  ImageOutputKind,
  ProductBrief,
  ScoreReport,
  SopStageEvent,
} from './types';

export type StageReporter = (event: SopStageEvent) => void;

const DIRECTION_PROGRESS = { catalog: 60, lifestyle: 65, campaign: 70 } as const;

export class SopAbortError extends Error {
  constructor() {
    super('Job cancelled');
    this.name = 'SopAbortError';
  }
}

export interface SopRunOptions {
  jobId: string;
  store: AppDataStore;
  abortSignal?: AbortSignal;
  onProgress?: StageReporter;
}

export async function runSop(opts: SopRunOptions): Promise<ImageJobRecord> {
  const { store, jobId, abortSignal } = opts;
  const job = store.get<ImageJobRecord>('image_jobs', jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);
  // Cancellation may have raced ahead of the background runner — respect it.
  if (job.status === 'cancelled' || job.status === 'failed' || job.status === 'completed') {
    return job;
  }
  const input = getInput(store, job.input_id);
  if (!input) {
    patchJob(store, jobId, {
      status: 'failed',
      stage: 'preprocessing',
      failure_reason: `商品输入 ${job.input_id} not found（可能已被删除）`,
      failure_stage: 'preprocessing',
    });
    return getJobOrThrow(store, jobId);
  }

  let currentStatus: ImageJobStatus = job.status;
  let currentStage = job.stage ?? 'queued';
  const reporter: StageReporter = (event) => {
    currentStatus = event.status;
    currentStage = event.stage;
    patchJob(store, event.jobId, {
      status: event.status,
      stage: event.stage,
      progress: event.progress,
    });
    opts.onProgress?.(event);
  };

  try {
    reporter({ jobId, status: 'preprocessing', stage: 'validate-input', progress: 5 });
    assertNotAborted(abortSignal);

    const aspectRatio = job.aspect_ratio || null;
    const referencePaths = readReferenceImagePaths(input);

    reporter({ jobId, status: 'identifying', stage: 'identify-brief', progress: 12 });
    const brief = await identifyBriefStage({
      input,
      referencePaths,
      abortSignal,
      store,
    });

    reporter({ jobId, status: 'cutting', stage: 'do-cutout', progress: 20 });
    const cutoutResult = await cutoutStage({
      jobId,
      input,
      referencePaths,
      brief,
      store,
      abortSignal,
      reporter,
      preferredAspect: aspectRatio || brief.recommendedAspectRatio,
    });

    if (!cutoutResult.imagePath) {
      const reason = cutoutResult.failureReason ?? '抠图重试 2 次仍未通过质检。';
      patchJob(store, jobId, {
        status: 'failed',
        stage: 'cutout-failed',
        progress: 30,
        failure_reason: reason,
        failure_stage: 'cutting',
        summary: '抠图阶段失败，未进入场景生成。',
      });
      reporter({ jobId, status: 'failed', stage: 'cutout-failed', progress: 30, message: reason });
      return getJobOrThrow(store, jobId);
    }

    patchJob(store, jobId, { cutout_path: cutoutResult.imagePath });

    reporter({ jobId, status: 'planning', stage: 'plan-directions', progress: 35 });
    const directions = await planDirections({
      prompt: buildPlanDirectionsPrompt(brief),
      abortSignal,
    });

    let lastScore: ScoreReport | null = null;
    let lastWinnerImage: string | null = null;
    let sceneAttempts = 0;
    let fallbackUsed = false;

    while (sceneAttempts < SOP_LIMITS.sceneAttempts) {
      sceneAttempts += 1;
      patchJob(store, jobId, { scene_attempts: sceneAttempts });
      assertNotAborted(abortSignal);

      reporter({
        jobId,
        status: 'generating',
        stage: `generate-scenes#${sceneAttempts}`,
        progress: 40,
      });
      const scenePaths = await generateThreeDirections({
        jobId,
        input,
        referencePaths: [cutoutResult.imagePath, ...referencePaths],
        brief,
        directions,
        store,
        abortSignal,
        reporter,
        fallback: sceneAttempts > 1,
        iteration: sceneAttempts,
      });

      if (scenePaths.length === 0) {
        // All three directions errored out this iteration — skip scoring and
        // either retry the whole batch or fall through to the fallback path.
        if (sceneAttempts >= SOP_LIMITS.sceneAttempts) break;
        continue;
      }
      reporter({ jobId, status: 'scoring', stage: 'score-scenes', progress: 75 });
      const scoreImages = [
        cutoutResult.imagePath,
        ...referencePaths,
        ...scenePaths.map((s) => s.path),
      ];
      const scoreReport = await scoreScenes({
        prompt: buildScoringPrompt(brief),
        imagePaths: scoreImages,
        abortSignal,
      });
      lastScore = scoreReport;

      const winner = scoreReport.winnerId !== 'none'
        ? scenePaths.find((s) => s.direction === scoreReport.winnerId)
        : undefined;
      if (winner) {
        markWinnerOutput(store, jobId, winner.path);
        lastWinnerImage = winner.path;
        patchJob(store, jobId, { winner_direction: winner.direction });
      }

      if (scoreReport.needsRerun || scoreReport.nextAction === 'rerun_scene_generation' || !winner) {
        if (sceneAttempts >= SOP_LIMITS.sceneAttempts) break;
        continue;
      }

      reporter({ jobId, status: 'refining', stage: 'do-refine', progress: 80 });
      const finalResult = await refineLoop({
        jobId,
        input,
        referencePaths: [winner.path, cutoutResult.imagePath, ...referencePaths],
        brief,
        scoreReport,
        store,
        abortSignal,
        reporter,
      });

      if (finalResult.kind === 'pass') {
        patchJob(store, jobId, {
          status: 'completed',
          stage: 'completed',
          progress: 100,
          final_image_path: finalResult.imagePath,
          summary: `选中方向 ${winner.direction}，终版精修通过质检。`,
        });
        reporter({ jobId, status: 'completed', stage: 'completed', progress: 100 });
        return getJobOrThrow(store, jobId);
      }

      if (finalResult.kind === 'rerun_scene') {
        if (sceneAttempts < SOP_LIMITS.sceneAttempts) continue;
        break;
      }

      // fallthrough: refine exhausted -> break to fallback
      break;
    }

    // Fallback path: white-background polish from cutout master.
    const fallbackPath = await generateOneImage({
      jobId,
      input,
      kind: 'fallback',
      iteration: 1,
      prompt: FALLBACK_PROMPT,
      referencePaths: [cutoutResult.imagePath, ...referencePaths],
      aspect: brief.recommendedAspectRatio,
      store,
      abortSignal,
    });

    if (fallbackPath) {
      fallbackUsed = true;
      patchJob(store, jobId, {
        status: 'completed',
        stage: 'fallback',
        progress: 100,
        final_image_path: fallbackPath,
        fallback_used: true,
        summary: lastScore
          ? `场景或精修阶段未通过质检（winner=${lastScore.winnerId}），已降级到白底兜底图。`
          : '场景或精修阶段失败，已降级到白底兜底图。',
      });
      reporter({ jobId, status: 'completed', stage: 'fallback', progress: 100 });
    } else {
      patchJob(store, jobId, {
        status: 'failed',
        stage: 'fallback-failed',
        progress: 100,
        failure_reason: '兜底白底图生成失败，请检查图像服务商配置。',
        failure_stage: 'fallback',
      });
      reporter({ jobId, status: 'failed', stage: 'fallback-failed', progress: 100 });
    }

    if (!fallbackUsed && !lastWinnerImage) {
      patchJob(store, jobId, {
        summary: '场景与精修均未通过质检，且兜底失败。',
      });
    }

    return getJobOrThrow(store, jobId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const aborted = abortSignal?.aborted || err instanceof SopAbortError;
    patchJob(store, jobId, {
      status: aborted ? 'cancelled' : 'failed',
      stage: aborted ? 'cancelled' : `${currentStage}-error`,
      failure_reason: aborted ? '任务被取消' : reason,
      failure_stage: aborted ? 'cancelled' : currentStatus,
    });
    reporter({
      jobId,
      status: aborted ? 'cancelled' : 'failed',
      stage: aborted ? 'cancelled' : `${currentStage}-error`,
      progress: 100,
      message: aborted ? '任务被取消' : reason,
    });
    return getJobOrThrow(store, jobId);
  }
}

function getJobOrThrow(store: AppDataStore, jobId: string): ImageJobRecord {
  const job = store.get<ImageJobRecord>('image_jobs', jobId);
  if (!job) throw new Error(`Job ${jobId} disappeared during run`);
  return job;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new SopAbortError();
}

async function identifyBriefStage(args: {
  input: ProductInputRow;
  referencePaths: string[];
  abortSignal?: AbortSignal;
  store: AppDataStore;
}): Promise<ProductBrief> {
  const allImages = [args.input.main_image_path, ...args.referencePaths];
  const brief = await identifyProductBrief({
    prompt: `${SYSTEM_PROMPT}\n\n${BRIEF_IDENTIFY_PROMPT}`,
    imagePaths: allImages,
    abortSignal: args.abortSignal,
  });
  upsertBrief(args.store, {
    input_id: args.input.id,
    brief: brief as unknown as Record<string, unknown>,
    raw: JSON.stringify(brief),
    confidence: brief.confidence,
  });
  return brief;
}

async function cutoutStage(args: {
  jobId: string;
  input: ProductInputRow;
  referencePaths: string[];
  brief: ProductBrief;
  store: AppDataStore;
  abortSignal?: AbortSignal;
  reporter: StageReporter;
  preferredAspect: string;
}): Promise<{ imagePath: string | null; failureReason?: string }> {
  let attempts = 0;
  let lastFailure: string | undefined;
  while (attempts < SOP_LIMITS.cutoutAttempts) {
    attempts += 1;
    patchJob(args.store, args.jobId, { cutout_attempts: attempts });
    args.reporter({
      jobId: args.jobId,
      status: 'cutting',
      stage: `do-cutout#${attempts}`,
      progress: 20 + attempts * 4,
    });
    const fallback = attempts > 1;
    const prompt = fallback ? `${CUTOUT_PROMPT}${CUTOUT_FALLBACK_HINT}` : CUTOUT_PROMPT;
    const cutoutPath = await generateOneImage({
      jobId: args.jobId,
      input: args.input,
      kind: 'cutout',
      iteration: attempts,
      prompt,
      referencePaths: [args.input.main_image_path, ...args.referencePaths],
      aspect: args.preferredAspect,
      store: args.store,
      abortSignal: args.abortSignal,
    });
    if (!cutoutPath) {
      lastFailure = '抠图请求失败：图像服务商返回空结果。';
      continue;
    }
    args.reporter({
      jobId: args.jobId,
      status: 'cutting',
      stage: `cutout-qc#${attempts}`,
      progress: 25 + attempts * 4,
    });
    const qc = await evaluateCutout({
      prompt: CUTOUT_QC_PROMPT,
      imagePaths: [cutoutPath, args.input.main_image_path, ...args.referencePaths],
      abortSignal: args.abortSignal,
    });
    appendOutput(args.store, {
      job_id: args.jobId,
      input_id: args.input.id,
      kind: 'cutout',
      iteration: attempts,
      image_path: cutoutPath,
      aspect_ratio: args.preferredAspect,
      qc_pass: qc.pass,
      qc_summary: JSON.stringify(qc.checks),
      qc_fail_reason: qc.failReason ?? null,
      prompt,
    });
    if (qc.pass) {
      return { imagePath: cutoutPath };
    }
    lastFailure = qc.failReason ?? '抠图质检未通过。';
  }
  return { imagePath: null, failureReason: lastFailure };
}

async function generateThreeDirections(args: {
  jobId: string;
  input: ProductInputRow;
  referencePaths: string[];
  brief: ProductBrief;
  directions: DirectionPlan[];
  store: AppDataStore;
  abortSignal?: AbortSignal;
  reporter: StageReporter;
  fallback: boolean;
  iteration: number;
}): Promise<Array<{ direction: 'catalog' | 'lifestyle' | 'campaign'; path: string }>> {
  const results: Array<{
    direction: 'catalog' | 'lifestyle' | 'campaign';
    path: string;
  }> = [];
  for (const direction of args.directions) {
    if (args.abortSignal?.aborted) throw new SopAbortError();
    args.reporter({
      jobId: args.jobId,
      status: 'generating',
      stage: `direction-${direction.id}#${args.iteration}`,
      progress: DIRECTION_PROGRESS[direction.id],
    });
    const prompt = buildSceneGenerationPrompt({
      brief: args.brief,
      direction,
      fallback: args.fallback,
    });
    try {
      const path = await generateOneImage({
        jobId: args.jobId,
        input: args.input,
        kind: direction.id as ImageOutputKind,
        iteration: args.iteration,
        prompt,
        referencePaths: args.referencePaths,
        aspect: args.brief.recommendedAspectRatio,
        store: args.store,
        abortSignal: args.abortSignal,
      });
      if (path) {
        results.push({ direction: direction.id, path });
      }
    } catch (err) {
      // Partial-failure tolerance: log and continue so the remaining directions
      // can still produce candidates. The scoring step gates whether to retry.
      if (err instanceof SopAbortError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      args.reporter({
        jobId: args.jobId,
        status: 'generating',
        stage: `direction-${direction.id}#${args.iteration}-failed`,
        progress: DIRECTION_PROGRESS[direction.id],
        message: `${direction.id} direction failed: ${reason}`,
      });
    }
  }
  return results;
}

async function refineLoop(args: {
  jobId: string;
  input: ProductInputRow;
  referencePaths: string[];
  brief: ProductBrief;
  scoreReport: ScoreReport;
  store: AppDataStore;
  abortSignal?: AbortSignal;
  reporter: StageReporter;
}): Promise<{ kind: 'pass'; imagePath: string } | { kind: 'rerun_scene' } | { kind: 'exhausted' }> {
  let attempts = 0;
  while (attempts < SOP_LIMITS.refineAttempts) {
    attempts += 1;
    patchJob(args.store, args.jobId, { refine_attempts: attempts });
    args.reporter({
      jobId: args.jobId,
      status: 'refining',
      stage: `do-refine#${attempts}`,
      progress: 82 + attempts * 4,
    });
    const finalPath = await generateOneImage({
      jobId: args.jobId,
      input: args.input,
      kind: 'final',
      iteration: attempts,
      prompt: buildFinalRefinePrompt({ brief: args.brief, scoreReport: args.scoreReport }),
      referencePaths: args.referencePaths,
      aspect: args.brief.recommendedAspectRatio,
      store: args.store,
      abortSignal: args.abortSignal,
    });
    if (!finalPath) {
      continue;
    }
    args.reporter({
      jobId: args.jobId,
      status: 'qc',
      stage: `final-qc#${attempts}`,
      progress: 90 + attempts * 2,
    });
    const qc = await evaluateFinal({
      prompt: FINAL_QC_PROMPT,
      imagePaths: [finalPath, args.referencePaths[1] ?? args.referencePaths[0], ...args.referencePaths.slice(2)],
      abortSignal: args.abortSignal,
    });
    appendOutput(args.store, {
      job_id: args.jobId,
      input_id: args.input.id,
      kind: 'final',
      iteration: attempts,
      image_path: finalPath,
      aspect_ratio: args.brief.recommendedAspectRatio,
      qc_pass: qc.pass,
      qc_summary: JSON.stringify(qc.checks),
      qc_fail_reason: qc.failReason ?? null,
      prompt: '终版精修',
      is_winner: qc.pass,
    });
    if (qc.pass) return { kind: 'pass', imagePath: finalPath };
    if (qc.retryStage === 'scene_generation') return { kind: 'rerun_scene' };
    // else final_refine -> retry
  }
  return { kind: 'exhausted' };
}

async function generateOneImage(args: {
  jobId: string;
  input: ProductInputRow;
  kind: ImageOutputKind;
  iteration: number;
  prompt: string;
  referencePaths: string[];
  aspect: string;
  store: AppDataStore;
  abortSignal?: AbortSignal;
}): Promise<string | null> {
  const params: GenerateImagesParams = {
    prompt: args.prompt,
    aspectRatio: args.aspect,
    n: 1,
    referenceImagePaths: args.referencePaths.filter(Boolean),
    abortSignal: args.abortSignal,
  };
  const result = await generateImages(params);
  const first = result.images?.[0];
  if (!first?.localPath) return null;
  const imagePath = first.localPath;
  if (args.kind !== 'cutout' && args.kind !== 'final') {
    appendOutput(args.store, {
      job_id: args.jobId,
      input_id: args.input.id,
      kind: args.kind,
      iteration: args.iteration,
      image_path: imagePath,
      aspect_ratio: args.aspect,
      prompt: args.prompt,
    });
  }
  return imagePath;
}

function markWinnerOutput(store: AppDataStore, jobId: string, imagePath: string): void {
  const outputs = store.query<{ id: string; image_path: string; is_winner: boolean }>(
    'image_outputs',
    { filter: { job_id: jobId }, limit: 200 },
  );
  for (const row of outputs) {
    const should = row.image_path === imagePath;
    if (row.is_winner !== should) {
      store.update('image_outputs', row.id, { is_winner: should });
    }
  }
}
