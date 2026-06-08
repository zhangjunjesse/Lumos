// 「我的产品」内联生成(MidJourney 式):选参考图(可跨产品/图库任意) + 提示词 → 图生图 → 一张新图,挂到目标产品下(新增)。
// 不做意图判断、不分印花/产品——提示词直接喂模型。结果存 MOCKUPS(source_product_id=目标产品: 采集 id 或手攒 id)。
// retryComposerMockup:用同样的参考图+提示词重生成、覆盖原 mockup(给溯源弹框的「重试」用)。走「设置→图片生成」服务商;失败如实记。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { generateImagesWithRetry } from './image-gen-retry';
import { loadImageAsBase64, type FetchedImage } from './image-fetch';
import { listStrategies } from './remix-strategies';
import { startMockupJob, finishMockupJob } from './mockup-jobs';
import { prepareMerge, mergeOneProduct } from './product-merge';
import { COLLECTIONS, type AssetRow, type CutoutRow, type ManualProductRow, type MockupRow, type ProductRow } from './types';

const TIMEOUT_MS = 600_000;

function labelOf(prompt: string): string {
  const p = prompt.trim();
  return p.length > 24 ? `${p.slice(0, 24)}…` : p;
}

// 把参考图 url(serve url / 直链)读成 base64;serve url 抠出本地路径直读。
async function loadRef(ref: string): Promise<FetchedImage> {
  if (ref.startsWith('/api/media/serve')) {
    let localPath: string | undefined;
    try {
      localPath = new URL(ref, 'http://localhost').searchParams.get('path') || undefined;
    } catch {
      /* 解析失败走 url */
    }
    return loadImageAsBase64({ localPath, url: ref });
  }
  return loadImageAsBase64({ url: ref });
}

// 生成核心:参考图(可空=纯文生图) + 提示词 → 一张图,返回本地路径(失败抛)。
async function generateFromRefs(prompt: string, references: string[]): Promise<string> {
  const refs: FetchedImage[] = [];
  for (const r of references) {
    try {
      refs.push(await loadRef(r));
    } catch {
      /* 单张参考图读不出就跳过,不阻断 */
    }
  }
  const res = await generateImagesWithRetry(
    { prompt, referenceImages: refs.length ? refs : undefined, abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
    3,
    '继续二创',
    { product: prompt, sources: references },
  );
  const out = res.images[0];
  if (!out?.localPath) throw new Error('图片服务商未返回结果（该模型可能不支持图像编辑）');
  return out.localPath;
}

export async function runComposerGenerate(
  store: AppDataStore,
  input: { userId: string; productId: string; references: string[]; prompt: string },
): Promise<{ ok: boolean; error?: string }> {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, error: '请输入提示词' };
  if (!resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false })) {
    return { ok: false, error: '未配置图片服务商。去「设置 → 图片生成」选一个支持图像编辑的服务商。' };
  }
  const base = {
    user_id: input.userId,
    source_product_id: input.productId,
    design_label: labelOf(prompt),
    prompt,
    ref_images: input.references,
    created_at: new Date().toISOString(),
  };
  const jobId = startMockupJob(store, { userId: input.userId, kind: 'compose', productId: input.productId, label: labelOf(prompt) });
  try {
    const imagePath = await generateFromRefs(prompt, input.references);
    store.create(COLLECTIONS.MOCKUPS, { ...base, image_path: imagePath, status: 'success' });
    finishMockupJob(store, jobId, true);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.create(COLLECTIONS.MOCKUPS, { ...base, status: 'failed', failure_reason: msg });
    finishMockupJob(store, jobId, false, msg);
    return { ok: false, error: msg };
  }
}

// 重试:用原参考图 + 提示词重生成,覆盖同一条 composer mockup(溯源弹框「重试」用)。
export async function retryComposerMockup(store: AppDataStore, userId: string, m: MockupRow): Promise<{ ok: boolean; error?: string }> {
  if (!m.prompt) return { ok: false, error: '老数据缺少提示词,无法重生成' };
  if (!resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false })) {
    return { ok: false, error: '未配置图片服务商(去「设置 → 图片生成」选一个)' };
  }
  try {
    const imagePath = await generateFromRefs(m.prompt, Array.isArray(m.ref_images) ? m.ref_images : []);
    store.update(COLLECTIONS.MOCKUPS, m.id, { image_path: imagePath, status: 'success', failure_reason: '' });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.update(COLLECTIONS.MOCKUPS, m.id, { status: 'failed', failure_reason: msg });
    return { ok: false, error: msg };
  }
}

// 「按方向出图」两步法 ——
// 第①步提示词:把源印花按方向改成一张「新印花」(独立设计稿,不是 T 恤);profile 自带改图指令,不做 vision 拆解/质检。
export function buildDirectionDesignPrompt(dir: { label: string; profile: string }): string {
  return [
    'Transform the reference PRINT DESIGN according to this remix direction —',
    dir.profile,
    'Output ONLY the redesigned artwork itself: a standalone print design on a plain white background — no t-shirt, no garment, no mockup, no model, no watermark text. Keep it a clean, ready-to-print graphic.',
  ].join('\n');
}

// 第②步提示词:把新印花印到 T 上出产品图。这步不再改图案(方向已在第①步用过)。
export function buildDesignMockupPrompt(): string {
  return [
    'Create a clean t-shirt PRODUCT MOCKUP: print the reference design onto a t-shirt, keeping the design itself UNCHANGED.',
    'Show the garment flat and front-facing on a neutral, plain background, the design centered on the chest. No model, no props, no watermark text.',
  ].join('\n');
}

const serveUrl = (p: string) => `/api/media/serve?path=${encodeURIComponent(p)}`;

// serve url → 取出本地 path(校验底图归属用);非 serve url 返回 null。
function servePath(url: string): string | null {
  if (!url.startsWith('/api/media/serve')) return null;
  try {
    return new URL(url, 'http://localhost').searchParams.get('path');
  } catch {
    return null;
  }
}

// 选「按方向出图」的源印花(改谁):默认该商品抠出的印花,也可选该商品已生成的二创印花(设计稿)。
// 两步法从「印花」出发——不接受产品图/原商品当底(那会变成产品→产品)。返回喂模型的 serve url;无印花可用时返回 null。导出供测试。
export function resolveDirectionBase(store: AppDataStore, userId: string, productId: string, baseRef?: string): string | null {
  const cutout = store.query<CutoutRow>(COLLECTIONS.CUTOUTS, {
    filter: { product_id: productId, status: 'success' },
    orderBy: { field: 'created_at', direction: 'desc' },
    limit: 1,
  })[0];
  const cutoutPath = cutout?.cutout_path ?? null;
  if (baseRef) {
    const wantPath = servePath(baseRef);
    if (wantPath) {
      const allowed = new Set<string>();
      if (cutoutPath) allowed.add(cutoutPath); // 原始印花
      // 该商品已生成的二创印花(设计稿)也能当源,继续往下改。
      for (const a of store.query<AssetRow>(COLLECTIONS.ASSETS, { filter: { user_id: userId, category: 'remix', product_id: productId, status: 'success' }, limit: 200 })) {
        if (typeof a.image_path === 'string' && a.image_path) allowed.add(a.image_path);
      }
      if (allowed.has(wantPath)) return baseRef; // 合法:用用户选的印花
    }
  }
  return cutoutPath ? serveUrl(cutoutPath) : null; // 默认/兜底:原始印花
}

// 「我的产品」按方向单发出图(两步法):选 1 个方向 + 1 张源印花(默认原始印花,可选该商品的二创印花)→
//   ① 按方向把源印花改成新印花(设计稿,存 remix asset,进图库/灵感)→
//   ② 把新印花印到 T 出产品图(存 MOCKUPS,溯源「用的印花」指向第①步的真印花)。
// 两张都留。不走完整二创链(无拆解/无多变体/无质检/不删旧图)。
export async function runDirectionMockup(
  store: AppDataStore,
  input: { userId: string; productId: string; directionCode: string; baseRef?: string },
): Promise<{ ok: boolean; error?: string }> {
  // 采集商品(PRODUCTS)或手攒产品(MANUAL_PRODUCTS)都可,只校验归属。
  const isCollected = store.get<ProductRow>(COLLECTIONS.PRODUCTS, input.productId)?.user_id === input.userId;
  const isManual = store.get<ManualProductRow>(COLLECTIONS.MANUAL_PRODUCTS, input.productId)?.user_id === input.userId;
  if (!isCollected && !isManual) return { ok: false, error: '商品不存在' };

  const dir = listStrategies(store, input.userId).find((s) => s.code === input.directionCode && s.enabled);
  if (!dir) return { ok: false, error: `方向「${input.directionCode}」不存在或已停用` };

  const sourceDesign = resolveDirectionBase(store, input.userId, input.productId, input.baseRef);
  if (!sourceDesign) return { ok: false, error: '该商品还没有印花可当底,先「抠印花」再按方向出图' };

  if (!resolveProviderForCapability({ moduleKey: 'image', capability: 'image-gen', allowDefault: false })) {
    return { ok: false, error: '未配置图片服务商。去「设置 → 图片生成」选一个支持图像编辑的服务商。' };
  }

  const now = () => new Date().toISOString();
  const jobId = startMockupJob(store, { userId: input.userId, kind: 'direction', productId: input.productId, label: dir.label });

  // ① 按方向把源印花改成新印花(设计稿)。
  let newDesignPath: string;
  try {
    newDesignPath = await generateFromRefs(buildDirectionDesignPrompt(dir), [sourceDesign]);
    store.create(COLLECTIONS.ASSETS, { user_id: input.userId, category: 'remix', product_id: input.productId, description: `方向·${dir.label}`, source_image_ids: [], image_path: newDesignPath, status: 'success', created_at: now() });
  } catch (err) {
    const msg = `出新印花失败:${err instanceof Error ? err.message : String(err)}`;
    finishMockupJob(store, jobId, false, msg);
    return { ok: false, error: msg };
  }

  // ② 把新印花印到 T 出产品图。溯源「用的印花」= 第①步的真印花。
  // 优先「锁色合成」:用该产品的空白 T 底图(和它其它产品图同一件)→ T 恤不变、只换印花。
  const design = { localPath: newDesignPath, url: serveUrl(newDesignPath), label: `方向·${dir.label}`, sourceProductId: input.productId };
  const productAsset = store.query<AssetRow>(COLLECTIONS.ASSETS, {
    filter: { user_id: input.userId, product_id: input.productId, category: 'product', status: 'success' },
    limit: 1,
  })[0];
  if (productAsset?.image_path) {
    const prep = await prepareMerge(store, input.userId, design);
    if ('error' in prep) {
      finishMockupJob(store, jobId, false, prep.error);
      return { ok: false, error: prep.error };
    }
    const ok = await mergeOneProduct(store, input.userId, design, prep, productAsset.id); // 内部存 MOCKUP(design_ref=新印花、product_asset_id=空白T)
    finishMockupJob(store, jobId, ok, ok ? undefined : '产品合成失败(看日志)');
    return ok ? { ok: true } : { ok: false, error: '产品合成失败(新印花已留在图库)' };
  }

  // 退回:该产品没有空白 T 底图(未跑过出产品图),直接由新印花生成产品图(T 恤由模型生成、可能每次不同)。
  const record = {
    user_id: input.userId,
    source_product_id: input.productId,
    design_label: `方向·${dir.label}`,
    design_ref: newDesignPath,
    prompt: buildDesignMockupPrompt(),
    ref_images: [serveUrl(newDesignPath)],
    created_at: now(),
  };
  try {
    const imagePath = await generateFromRefs(buildDesignMockupPrompt(), [serveUrl(newDesignPath)]);
    store.create(COLLECTIONS.MOCKUPS, { ...record, image_path: imagePath, status: 'success' });
    finishMockupJob(store, jobId, true);
    return { ok: true };
  } catch (err) {
    const msg = `出产品图失败(新印花已留在图库):${err instanceof Error ? err.message : String(err)}`;
    store.create(COLLECTIONS.MOCKUPS, { ...record, status: 'failed', failure_reason: msg });
    finishMockupJob(store, jobId, false, msg);
    return { ok: false, error: msg };
  }
}
