// Remix — 6 个二创动作统一入口
// recolor / restyle / resubject / series：调 image-gen 复用原图作参考 reference_image_paths
// resize / removebg：MVP 阶段尚未接入图片处理后端，显式 not-implemented，不假装成功

import crypto from 'node:crypto';
import { generateImages } from '@/lib/image';
import {
  consumeRemoteQuota,
  refundRemoteQuota,
  resolveBillingTarget,
} from '@/lib/tools/image-gen-billing';
import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { composeRemixPrompt } from './prompt-composer';
import { COLLECTIONS, type ImageRow, type RemixAction, type RunRow } from './types';

export interface RemixInput {
  userId: string;
  sessionId?: string;
  imageId: string;
  action: RemixAction;
}

export interface RemixVariantResult {
  ok: boolean;
  imageId?: string;
  filePath?: string;
  error?: string;
}

export interface RemixResult {
  runId: string;
  action: RemixAction;
  succeededCount: number;
  failedCount: number;
  variants: RemixVariantResult[];
  notImplemented?: boolean;
  notImplementedReason?: string;
}

export async function remixImage(store: AppDataStore, input: RemixInput): Promise<RemixResult> {
  const { userId, sessionId, imageId, action } = input;

  if (action === 'resize' || action === 'removebg') {
    // MVP：图片处理后端（sharp / rembg）未接入；显式 not-implemented
    return notImplementedResult(action);
  }

  const original = store.get<ImageRow>(COLLECTIONS.IMAGES, imageId);
  if (!original) {
    return {
      runId: '',
      action,
      succeededCount: 0,
      failedCount: 0,
      variants: [],
      notImplemented: false,
    };
  }

  if (original.source_type === 'remixed' && original.parent_image_id) {
    // 允许二创的二创，但要追踪到根原图
  }

  const palette = parsePalette(original.palette);
  const composed = composeRemixPrompt({
    action,
    originalTheme: original.theme,
    originalStyle: original.style,
    originalPalette: palette,
  });

  const startedAt = new Date().toISOString();
  const runRow = store.create<Omit<RunRow, 'id'>>(COLLECTIONS.RUNS, {
    user_id: userId,
    kind: 'remix_batch',
    themes_json: JSON.stringify([original.theme]),
    strategy: 'main',
    generated_count: 0,
    succeeded_count: 0,
    failed_count: 0,
    liked_count: 0,
    quota_spent: 0,
    status: 'running',
    started_at: startedAt,
  });

  // image-gen-tool 单次 count max=4，正好对应 4 个变体
  const variants = await generateRemixVariants({
    prompt: composed.prompt,
    referenceImagePath: original.file_path,
    count: composed.variantCount,
    userId,
    sessionId,
    store,
    originalImage: original,
    action,
  });

  const ok = variants.filter((v) => v.ok).length;
  const failed = variants.length - ok;
  const status: RunRow['status'] = failed === 0 ? 'success' : ok === 0 ? 'failed' : 'partial';
  store.update<RunRow>(COLLECTIONS.RUNS, runRow.id, {
    generated_count: variants.length,
    succeeded_count: ok,
    failed_count: failed,
    quota_spent: ok,
    status,
    ended_at: new Date().toISOString(),
  });

  return {
    runId: runRow.id,
    action,
    succeededCount: ok,
    failedCount: failed,
    variants,
  };
}

interface GenVariantsInput {
  prompt: string;
  referenceImagePath: string;
  count: number;
  userId: string;
  sessionId: string | undefined;
  store: AppDataStore;
  originalImage: ImageRow;
  action: RemixAction;
}

async function generateRemixVariants(input: GenVariantsInput): Promise<RemixVariantResult[]> {
  const target = resolveBillingTarget();
  if ('error' in target) {
    return [{ ok: false, error: target.error }];
  }
  if (!target.model) {
    return [{ ok: false, error: '当前云端图片服务商无可用模型。' }];
  }

  const idempotencyKey = crypto.randomUUID();
  let quotaConsumed = false;
  if (input.userId && target.remoteProviderId) {
    const check = await consumeRemoteQuota({
      userId: input.userId,
      providerId: target.remoteProviderId,
      model: target.model,
      count: input.count,
      idempotencyKey,
    });
    if (!check.ok) return [{ ok: false, error: check.error }];
    quotaConsumed = true;
  }

  try {
    const result = await generateImages({
      prompt: input.prompt,
      model: target.model,
      aspectRatio: '1:1',
      imageSize: '1K',
      n: input.count,
      referenceImagePaths: [input.referenceImagePath],
      sessionId: input.sessionId,
    });

    const variants: RemixVariantResult[] = [];
    for (const img of result.images) {
      const row = input.store.create<Omit<ImageRow, 'id'>>(COLLECTIONS.IMAGES, {
        user_id: input.userId,
        source_type: 'remixed',
        parent_image_id: input.originalImage.id,
        remix_action: input.action,
        prompt_used: input.prompt,
        theme: input.originalImage.theme,
        style: input.originalImage.style,
        palette: input.originalImage.palette,
        composition: input.originalImage.composition,
        file_path: img.localPath,
        width: 1024,
        height: 1024,
        in_library: false,
        ai_generated_tag: true,
        created_at: new Date().toISOString(),
      });
      variants.push({ ok: true, imageId: row.id, filePath: img.localPath });
    }
    return variants;
  } catch (err) {
    if (input.userId && quotaConsumed) await refundRemoteQuota(input.userId, idempotencyKey);
    const msg = err instanceof Error ? err.message : String(err);
    return [{ ok: false, error: msg }];
  }
}

function parsePalette(s: string | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function notImplementedResult(action: RemixAction): RemixResult {
  const reasonMap: Record<string, string> = {
    resize: '改尺寸 (resize) MVP 阶段尚未接入图片处理后端（sharp）。当前可用替代：直接在二创变体里挑选适合 T-shirt / poster / mug 尺寸的构图。',
    removebg: '去背景 (removebg) MVP 阶段尚未接入图片处理后端（rembg）。当前可用替代：换风格 → flat illustration 或 silhouette 通常会产出透明/简洁背景。',
  };
  return {
    runId: '',
    action,
    succeededCount: 0,
    failedCount: 0,
    variants: [],
    notImplemented: true,
    notImplementedReason: reasonMap[action] ?? `${action} 尚未接入。`,
  };
}
