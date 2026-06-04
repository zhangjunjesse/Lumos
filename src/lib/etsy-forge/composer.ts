// 「我的产品」内联生成(MidJourney 式):选参考图(可跨产品/图库任意) + 提示词 → 图生图 → 一张新图,挂到目标产品下(新增)。
// 不做意图判断、不分印花/产品——提示词直接喂模型。结果存 MOCKUPS(source_product_id=目标产品: 采集 id 或手攒 id)。
// retryComposerMockup:用同样的参考图+提示词重生成、覆盖原 mockup(给溯源弹框的「重试」用)。走「设置→图片生成」服务商;失败如实记。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { resolveProviderForCapability } from '@/lib/provider-resolver';
import { generateImagesWithRetry } from './image-gen-retry';
import { loadImageAsBase64, type FetchedImage } from './image-fetch';
import { COLLECTIONS, type MockupRow } from './types';

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
  try {
    const imagePath = await generateFromRefs(prompt, input.references);
    store.create(COLLECTIONS.MOCKUPS, { ...base, image_path: imagePath, status: 'success' });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.create(COLLECTIONS.MOCKUPS, { ...base, status: 'failed', failure_reason: msg });
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
