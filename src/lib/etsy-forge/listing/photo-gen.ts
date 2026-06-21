// 产品开发「图片」批量出商品图 + 精修。SOP:印花=唯一真图参考(单图单参考,不多图融合);
// 模特/场景/姿势是已读成的文字方向(dirs);颜色集=主轴,每色一张模特图、换人换景不克隆。
// resolveBatchGen(纯,出 prompt) → runPhotoGenJob(异步,generateFromRefs([印花], prompt))。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { generateFromRefs } from '../composer';
import {
  detailShotPrompt,
  flatMainPrompt,
  modelShotPrompt,
  MODEL_ROSTER,
  POSE_ROSTER,
  refinePrompt,
  SCENE_PROPS,
  SCENE_ROSTER,
  sceneShotPrompt,
  SHIRT_COLORS,
  styleFragment,
  type ShirtColor,
} from './photo-roles';
import { finishPhotoJob } from './photo-jobs';
import type { ListingRow, PhotoRole } from './types';

const serveUrl = (p: string) => `/api/media/serve?path=${encodeURIComponent(p)}`;

export interface GenSpec {
  ref: string; // 印花(唯一真图参考)
  prompt: string;
  label: string;
  role?: PhotoRole;
}
export interface BatchSelection {
  colors: string[]; // 选的 T 恤颜色代号
  style?: string; // 整体风格(界面单选;默认手机随拍)
  extra?: string; // 用户自由输入的额外要求(注入每张 prompt)
  modelCount?: number; // 模特上身图张数(SOP §2 要 3-4，默认 4)
  modelRefs?: string[]; // 图库素材 src(后端每次 vision 详细读成方向文字)
  sceneRefs?: string[];
  poseRefs?: string[];
  productRefs?: string[]; // 已采集/关注的真实商品图(整体读氛围方向,不抄像素)
  outputs?: { model?: boolean; scene?: boolean; detail?: boolean; flat?: boolean };
}
export interface Directions {
  modelDescs: string[]; // 已读成的文字方向(vision)
  sceneDescs: string[];
  poseDescs: string[];
  productDescs?: string[]; // 真实商品图整体氛围方向(选了就优先按它出)
}

const pick = <T>(arr: T[], i: number): T => arr[i % arr.length];

// 纯:印花 + 颜色集 + 文字方向 → 一批 prompt 规格。每张只用印花当参考。
export function resolveBatchGen(listing: ListingRow, sel: BatchSelection, dirs: Directions): GenSpec[] {
  const design = listing.design_src || '';
  if (!design) throw new Error('先设印花——它是唯一的真图参考(SOP 铁律1)。');

  const colors = (sel.colors ?? [])
    .map((n) => SHIRT_COLORS.find((c) => c.name === n))
    .filter((c): c is ShirtColor => !!c);
  if (!colors.length) throw new Error('选至少一个 T 恤颜色（Comfort Colors）。');

  const out = sel.outputs ?? { model: true, scene: true, detail: true, flat: true };
  if (!out.model && !out.scene && !out.detail && !out.flat) {
    throw new Error('选至少一种输出图（模特上身 / 场景氛围 / 设计特写 / 平铺主图）。');
  }

  // 方向:用户读图来的优先;空则用内置多样化池(防克隆)。
  // 方向优先级:① 选了「已采集/关注商品图」→ 照那张的整体氛围出(最强信号:照这张出);
  // ② 否则用「模特/场景/姿势」组合;③ 都没选 → 默认多样化池。每张轮换(铁律4 不克隆)。
  const ms = dirs.modelDescs.length ? dirs.modelDescs : MODEL_ROSTER;
  const ps = dirs.poseDescs.length ? dirs.poseDescs : POSE_ROSTER;
  const ss = dirs.sceneDescs.length ? dirs.sceneDescs : SCENE_ROSTER;
  const prod = dirs.productDescs ?? [];

  const sf = styleFragment(sel.style); // 整体风格(默认手机随拍)
  const extra = (sel.extra ?? '').trim();
  const withExtra = (p: string) => (extra ? `${p}\nAdditional requirements from the seller (must apply): ${extra}` : p);
  const specs: GenSpec[] = [];
  const modelCount = out.model ? Math.max(1, Math.min(8, sel.modelCount ?? 4)) : 0;
  for (let k = 0; k < modelCount; k++) {
    const mps = prod.length ? pick(prod, k) : `${pick(ms, k)}, ${pick(ps, k)}, in ${pick(ss, k)}`;
    specs.push({ ref: design, prompt: withExtra(modelShotPrompt(pick(colors, k), mps, sf)), label: '商品图', role: 'model' });
  }
  // 场景氛围:1-2 张。
  if (out.scene) {
    const n = Math.min(2, ss.length);
    for (let j = 0; j < n; j++) {
      specs.push({ ref: design, prompt: withExtra(sceneShotPrompt(pick(colors, j), pick(ss, j), pick(SCENE_PROPS, j), sf)), label: '商品图', role: 'scene' });
    }
  }
  // 设计特写:1 张。
  if (out.detail) specs.push({ ref: design, prompt: withExtra(detailShotPrompt(colors[0])), label: '商品图', role: 'detail' });
  // 平铺白底主图:1 张(主色)。
  if (out.flat) specs.push({ ref: design, prompt: withExtra(flatMainPrompt(colors[0])), label: '商品图', role: 'main' });

  return specs;
}

// 精修:对已生成的某张商品图按指令再编辑(img2img)。
export interface RefineSpec {
  refs: string[];
  prompt: string;
  label: string;
}
export function resolveRefine(src: string, instruction: string): RefineSpec {
  if (!src) throw new Error('缺少要精修的图');
  return { refs: [src], prompt: refinePrompt(instruction), label: '精修' };
}

// fire-and-forget：跑生成核心，成功写 result_src、失败写 error，都落 job 终态。批量与精修共用。
export async function runPhotoGenJob(
  store: AppDataStore,
  jobId: string,
  refs: string[],
  prompt: string,
  log?: { scope?: string; product?: string }, // 透传给日志(重生成传 {scope:'重生成'} 便于排查)
): Promise<void> {
  try {
    const path = await generateFromRefs(prompt, refs, log);
    finishPhotoJob(store, jobId, true, serveUrl(path));
  } catch (err) {
    finishPhotoJob(store, jobId, false, undefined, err instanceof Error ? err.message : String(err));
  }
}
