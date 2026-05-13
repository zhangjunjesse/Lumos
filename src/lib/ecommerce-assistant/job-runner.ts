import { runSop, SopAbortError } from './sop-engine';
import {
  createJobRecord,
  ensureBuiltinStylePresets,
  getEcommerceStore,
  getInput,
  getJob,
  patchJob,
} from './storage';
import type { DiscoverCandidateRecord, ImageJobRecord, ProductInputRecord, SopStageEvent } from './types';

const REGISTRY_KEY = '__lumos_ecommerce_job_registry';

interface RegistryState {
  controllers: Map<string, AbortController>;
  listeners: Map<string, Set<(event: SopStageEvent) => void>>;
}

function getState(): RegistryState {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[REGISTRY_KEY]) {
    g[REGISTRY_KEY] = {
      controllers: new Map<string, AbortController>(),
      listeners: new Map<string, Set<(event: SopStageEvent) => void>>(),
    };
  }
  return g[REGISTRY_KEY] as RegistryState;
}

export function isJobRunning(jobId: string): boolean {
  return getState().controllers.has(jobId);
}

export function subscribeJob(jobId: string, listener: (event: SopStageEvent) => void): () => void {
  const state = getState();
  let listeners = state.listeners.get(jobId);
  if (!listeners) {
    listeners = new Set();
    state.listeners.set(jobId, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners && listeners.size === 0) {
      state.listeners.delete(jobId);
    }
  };
}

function emit(jobId: string, event: SopStageEvent): void {
  const listeners = getState().listeners.get(jobId);
  if (!listeners) return;
  for (const l of listeners) {
    try {
      l(event);
    } catch (err) {
      console.error('[ecommerce-assistant] job listener failed:', err);
    }
  }
}

interface StartJobArgs {
  inputId: string;
  presetId?: string;
  aspectRatio?: string;
}

export async function startJob(args: StartJobArgs): Promise<ImageJobRecord> {
  const store = getEcommerceStore();
  ensureBuiltinStylePresets(store);
  const input = getInput(store, args.inputId);
  if (!input) throw new Error(`商品输入 ${args.inputId} 不存在或已被归档。`);
  if (input.status !== 'ready') {
    throw new Error(`商品输入 ${args.inputId} 当前状态为 ${input.status}，无法启动出图任务。`);
  }
  if (!input.main_image_path) {
    throw new Error('商品输入缺少主图路径，请先补充后再启动任务。');
  }
  assertMainImageIsRealProductPhoto(store, input);
  const job = createJobRecord(store, {
    input_id: args.inputId,
    preset_id: args.presetId,
    aspect_ratio: args.aspectRatio,
  });
  void runJobInBackground(job.id);
  return job;
}

function assertMainImageIsRealProductPhoto(
  store: ReturnType<typeof getEcommerceStore>,
  input: ProductInputRecord,
): void {
  const mainImagePath = input.main_image_path?.trim();
  if (!mainImagePath) return;
  const promoted = store
    .query<DiscoverCandidateRecord>('discover_candidates', {
      filter: { promoted_input_id: input.id },
      limit: 1,
    })
    .at(0);
  const conceptImagePath = promoted?.concept_image_path?.trim();
  if (conceptImagePath && conceptImagePath === mainImagePath) {
    throw new Error('当前主图是 AI 概念图占位。出图 SOP 必须基于真实样品图，请先上传真实商品主图。');
  }
}

async function runJobInBackground(jobId: string): Promise<void> {
  const state = getState();
  if (state.controllers.has(jobId)) return;
  const controller = new AbortController();
  state.controllers.set(jobId, controller);
  const store = getEcommerceStore();
  try {
    await runSop({
      jobId,
      store,
      abortSignal: controller.signal,
      onProgress: (event) => emit(jobId, event),
    });
  } catch (err) {
    if (err instanceof SopAbortError) {
      patchJob(store, jobId, {
        status: 'cancelled',
        stage: 'cancelled',
        failure_reason: '任务被取消',
        failure_stage: 'cancelled',
      });
    } else {
      const reason = err instanceof Error ? err.message : String(err);
      patchJob(store, jobId, {
        status: 'failed',
        stage: 'error',
        failure_reason: reason,
        failure_stage: 'unknown',
      });
    }
  } finally {
    state.controllers.delete(jobId);
  }
}

export function cancelJob(jobId: string): boolean {
  const state = getState();
  const controller = state.controllers.get(jobId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export async function retryJob(jobId: string): Promise<ImageJobRecord> {
  const store = getEcommerceStore();
  const job = getJob(store, jobId);
  if (!job) throw new Error(`任务 ${jobId} 不存在。`);
  return startJob({
    inputId: job.input_id,
    presetId: job.preset_id ?? undefined,
    aspectRatio: job.aspect_ratio ?? undefined,
  });
}

export async function resumeRunningJobs(): Promise<void> {
  // After process restart, mark previously running jobs as failed because their
  // in-memory abort controllers and SOP state cannot be recovered.
  const store = getEcommerceStore();
  const all = store.query<ImageJobRecord>('image_jobs', { limit: 500 });
  const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
  for (const row of all) {
    if (TERMINAL.has(row.status)) continue;
    patchJob(store, row.id, {
      status: 'failed',
      stage: 'restart',
      failure_reason: '应用重启时任务尚未完成，已自动标记为失败。请重新运行。',
      failure_stage: 'restart',
    });
  }
}
