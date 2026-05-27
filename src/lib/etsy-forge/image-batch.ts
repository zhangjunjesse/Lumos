// Image batch — 50 张并发编排
// 严格走 src/lib/tools/image-gen-billing.ts 体系（resolveBillingTarget + consumeRemoteQuota + refundRemoteQuota）
// 单次 image-gen-tool count max=4，但本应用一张一图（每个 slot 独立），并发上限来自 settings.concurrency_per_batch
// 失败单张自动跳过，不阻塞整批。

import crypto from 'node:crypto';
import { generateImages } from '@/lib/image';
import {
  consumeRemoteQuota,
  refundRemoteQuota,
  resolveBillingTarget,
} from '@/lib/tools/image-gen-billing';
import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { composePushPrompt } from './prompt-composer';
import { fingerprint, recommendBatch } from './recommender';
import { loadTasteProfile } from './taste-profile';
import { loadCurrentSignals } from './trend-signals';
import {
  COLLECTIONS,
  DEFAULT_SETTINGS,
  type AppSettings,
  type ImageRow,
  type PushSlot,
  type RunRow,
} from './types';

export interface CreateBatchInput {
  userId: string;
  sessionId?: string;
  size?: number;
}

export interface SlotResult {
  slot: PushSlot;
  ok: boolean;
  imageId?: string;
  filePath?: string;
  error?: string;
}

export interface CreateBatchResult {
  batchId: string;
  runId: string;
  succeededCount: number;
  failedCount: number;
  quotaSpent: number;
  results: SlotResult[];
  strategy: string;
  themesUsed: string[];
  signalsStatus: string;
}

export async function createPushBatch(
  store: AppDataStore,
  input: CreateBatchInput,
): Promise<CreateBatchResult> {
  const settings = readSettings(store);
  const batchSize = input.size ?? settings.batch_size;
  const userId = input.userId;

  const weekly = loadCurrentSignals(store);
  const taste = loadTasteProfile(store, userId);
  const lastFingerprints = loadLastBatchFingerprints(store, userId, batchSize);

  const recommendation = recommendBatch({
    weekly,
    taste,
    lastBatchFingerprints: lastFingerprints,
    batchSize,
  });

  const startedAt = new Date().toISOString();
  const batchId = crypto.randomUUID();
  const runRow = store.create<Omit<RunRow, 'id'>>(COLLECTIONS.RUNS, {
    user_id: userId,
    kind: 'push_batch',
    themes_json: JSON.stringify(recommendation.themesUsed),
    strategy: recommendation.strategy,
    generated_count: 0,
    succeeded_count: 0,
    failed_count: 0,
    liked_count: 0,
    quota_spent: 0,
    status: 'running',
    started_at: startedAt,
  });

  const results = await runConcurrent(
    recommendation.slots,
    settings.concurrency_per_batch,
    (slot) => generateOneSlot(store, slot, taste, userId, input.sessionId, batchId),
  );

  let ok = 0;
  let failed = 0;
  let quotaSpent = 0;
  for (const r of results) {
    if (r.ok) {
      ok++;
      quotaSpent += 1; // 每张默认 1 单位；真实配额由 consumeRemoteQuota 决定，这里只是计数
    } else {
      failed++;
    }
  }

  const endedAt = new Date().toISOString();
  const status: RunRow['status'] = failed === 0 ? 'success' : ok === 0 ? 'failed' : 'partial';
  store.update<RunRow>(COLLECTIONS.RUNS, runRow.id, {
    generated_count: ok + failed,
    succeeded_count: ok,
    failed_count: failed,
    quota_spent: quotaSpent,
    status,
    ended_at: endedAt,
  });

  return {
    batchId,
    runId: runRow.id,
    succeededCount: ok,
    failedCount: failed,
    quotaSpent,
    results,
    strategy: recommendation.strategy,
    themesUsed: recommendation.themesUsed,
    signalsStatus: recommendation.signalsStatus,
  };
}

async function generateOneSlot(
  store: AppDataStore,
  slot: PushSlot,
  taste: ReturnType<typeof loadTasteProfile>,
  userId: string,
  sessionId: string | undefined,
  batchId: string,
): Promise<SlotResult> {
  const prompt = composePushPrompt({ slot, taste });
  const target = resolveBillingTarget();
  if ('error' in target) return { slot, ok: false, error: target.error };
  if (!target.model) {
    return {
      slot,
      ok: false,
      error: '当前云端图片服务商无可用模型 — 请联系管理员在 /admin/image-providers 配置 model_catalog。',
    };
  }

  const idempotencyKey = crypto.randomUUID();
  let quotaConsumed = false;
  if (userId && target.remoteProviderId) {
    const check = await consumeRemoteQuota({
      userId,
      providerId: target.remoteProviderId,
      model: target.model,
      count: 1,
      idempotencyKey,
    });
    if (!check.ok) return { slot, ok: false, error: check.error };
    quotaConsumed = true;
  }

  try {
    const result = await generateImages({
      prompt,
      model: target.model,
      aspectRatio: '1:1',
      imageSize: '1K',
      n: 1,
      sessionId,
    });
    const img = result.images[0];
    if (!img) {
      if (userId && quotaConsumed) await refundRemoteQuota(userId, idempotencyKey);
      return { slot, ok: false, error: 'no image returned' };
    }
    const row = store.create<Omit<ImageRow, 'id'>>(COLLECTIONS.IMAGES, {
      user_id: userId,
      source_type: 'generated',
      prompt_used: prompt,
      theme: slot.theme,
      style: slot.style,
      palette: JSON.stringify(slot.palette),
      composition: slot.composition,
      file_path: img.localPath,
      width: 1024,
      height: 1024,
      in_library: false,
      batch_id: batchId,
      fingerprint: fingerprint(slot.theme, slot.style, slot.palette, slot.composition),
      ai_generated_tag: true,
      created_at: new Date().toISOString(),
    });
    return { slot, ok: true, imageId: row.id, filePath: img.localPath };
  } catch (err) {
    if (userId && quotaConsumed) await refundRemoteQuota(userId, idempotencyKey);
    const msg = err instanceof Error ? err.message : String(err);
    return { slot, ok: false, error: msg };
  }
}

async function runConcurrent<I, O>(
  items: I[],
  concurrency: number,
  worker: (item: I, index: number) => Promise<O>,
): Promise<O[]> {
  const results: O[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function loadLastBatchFingerprints(store: AppDataStore, userId: string, sampleN: number): string[] {
  const lastRuns = store.query<RunRow>(COLLECTIONS.RUNS, {
    filter: { user_id: userId, kind: 'push_batch' },
    orderBy: { field: 'started_at', direction: 'desc' },
    limit: 2,
  });
  if (lastRuns.length === 0) return [];
  const recentBatchIds = lastRuns.map((r) => r.id);
  const fps: string[] = [];
  for (const bid of recentBatchIds) {
    const imgs = store.query<ImageRow>(COLLECTIONS.IMAGES, {
      filter: { batch_id: bid },
      limit: sampleN,
    });
    for (const img of imgs) if (img.fingerprint) fps.push(img.fingerprint);
  }
  return fps;
}

function readSettings(store: AppDataStore): AppSettings {
  const row = store.query<AppSettings>(COLLECTIONS.APP_SETTINGS, { limit: 1 })[0];
  if (!row) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...row };
}
