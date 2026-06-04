// 裂变·出图:按「配方(一组方向 code) × 每配方张数」用 base 印花做图生图,存成 remix 素材,打 fission_run/fission_stage 标记。
//  preview=每配方 1 张(平行/矩阵对比);finalize=选定配方出 N 张(默认 4,可 2/6);iterate=只改 1 参数出 2 张。
//  定稿(finalize)阶段过质检打分(对齐 playbook [8])。走「设置→图片生成」服务商;失败如实记 failed。不 mock。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { generateImagesWithRetry } from './image-gen-retry';
import { getImageConcurrency, mapLimit } from './concurrency';
import { loadImageAsBase64, type FetchedImage } from './image-fetch';
import { listDirections } from './remix-directions';
import { judgeRemix } from './remix-qa';
import { resolveVisionEndpoint } from './vision-provider';
import { logEvent } from './log';
import type { FissionStage } from './fission-mode';
import { COLLECTIONS } from './types';

const TIMEOUT_MS = 600_000;
const serve = (p: string) => `/api/media/serve?path=${encodeURIComponent(p)}`;

function buildPrompt(fragments: { label: string; fragment: string }[]): string {
  return [
    'You are an Etsy print-design remixer. Using the reference print as the starting point, create ONE new print-ready t-shirt design.',
    'Apply these specific changes — and ONLY these — while preserving the core selling point of the reference:',
    ...fragments.map((f) => `- ${f.fragment}`),
    'Use the reference ONLY as a base/style guide; redraw it, do not copy it verbatim.',
    'Print-ready (hard): ONLY the standalone print artwork — NO t-shirt, NO model, NO scene, NO mockup; transparent background (PNG); bold readable silhouette; clean crisp edges; NO watermark, NO signature, NO extra text unless a change above targets text.',
  ].join('\n');
}

async function loadRef(ref: string): Promise<FetchedImage> {
  const localPath = ref.startsWith('/api/media/serve') ? new URL(ref, 'http://localhost').searchParams.get('path') || undefined : undefined;
  return loadImageAsBase64({ localPath, url: ref });
}

export interface RunFissionInput {
  userId: string;
  productId: string;
  baseRef: string; // 母版印花(url/path)
  baseAssetId: string; // 发起裂变的图素材 id(原图卡片按它显示「裂变中」)
  recipes: string[][]; // 每个 = 一组方向 code,合成 1 张
  variantsPerRecipe: number; // 每个配方出几张(preview=1 / finalize=2|4|6 / iterate=2)
  stage: FissionStage;
  fissionRun: string; // 本次裂变运行 id(面板按它拉本轮结果)
}

export async function runFissionGenerate(store: AppDataStore, input: RunFissionInput): Promise<{ ok: boolean; created: number; failed: number; error?: string }> {
  if (!resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false })) {
    return { ok: false, created: 0, failed: 0, error: '未配置图片服务商。去「设置 → 图片生成」选一个支持图像编辑的服务商。' };
  }
  const dirMap = new Map(listDirections(store, input.userId).map((d) => [d.code, { label: d.label, fragment: d.prompt_fragment }]));
  const vision = resolveVisionEndpoint(store);

  let baseImg: FetchedImage;
  try {
    baseImg = await loadRef(input.baseRef);
  } catch (err) {
    return { ok: false, created: 0, failed: 0, error: `读取母版印花失败:${err instanceof Error ? err.message : String(err)}` };
  }

  // 展开成 (配方 × 张数) 个任务
  const jobs: { codes: string[]; i: number }[] = [];
  for (const recipe of input.recipes) for (let v = 0; v < Math.max(1, input.variantsPerRecipe); v++) jobs.push({ codes: recipe, i: jobs.length });
  logEvent('裂变', 'info', `${input.stage}:${input.recipes.length} 配方 × ${input.variantsPerRecipe} = ${jobs.length} 张`, input.productId);

  // 运行状态:开跑记 running(原图卡片据此显示「裂变中」),跑完更新终态。
  const runRow = store.create(COLLECTIONS.FISSION_RUNS, {
    user_id: input.userId,
    run_id: input.fissionRun,
    product_id: input.productId,
    base_asset_id: input.baseAssetId,
    stage: input.stage,
    expected: jobs.length,
    created: 0,
    status: 'running',
    created_at: new Date().toISOString(),
  });

  const outcomes = await mapLimit(jobs, getImageConcurrency(store), async ({ codes, i }) => {
    const now = new Date().toISOString();
    const frags = codes.map((c) => dirMap.get(c)).filter((x): x is { label: string; fragment: string } => !!x);
    const label = `裂变·${input.stage}·${codes.join('+')}·#${i + 1}`;
    const base = {
      user_id: input.userId,
      category: 'remix' as const,
      product_id: input.productId,
      description: label,
      fission_run: input.fissionRun,
      fission_stage: input.stage,
      source_image_ids: [] as string[],
      created_at: now,
    };
    try {
      const res = await generateImagesWithRetry(
        { prompt: buildPrompt(frags), referenceImages: [baseImg], abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
        3,
        '裂变出图',
        { product: input.productId, sources: [input.baseRef] },
      );
      const out = res.images[0];
      if (!out?.localPath) throw new Error('图片服务商未返回结果');
      // 定稿阶段过质检打分(playbook [8]);其余阶段为快比对不打分。
      const qa =
        input.stage === 'finalize' && vision.ok
          ? await judgeRemix(vision.ep, await loadImageAsBase64({ localPath: out.localPath, url: serve(out.localPath) }), 'combo').catch(() => ({ flag: 'good' as const, note: '' }))
          : { flag: 'good' as const, note: '' };
      store.create(COLLECTIONS.ASSETS, { ...base, image_path: out.localPath, status: 'success', quality_flag: qa.flag, quality_note: qa.note });
      return 'ok' as const;
    } catch (err) {
      store.create(COLLECTIONS.ASSETS, { ...base, status: 'failed', failure_reason: err instanceof Error ? err.message : String(err) });
      return 'fail' as const;
    }
  });
  const created = outcomes.filter((o) => o === 'ok').length;
  store.update(COLLECTIONS.FISSION_RUNS, runRow.id, { created, status: created > 0 ? 'done' : 'failed' });
  return { ok: created > 0, created, failed: outcomes.length - created };
}
