// ②b 详情图分类:走「设置→识图服务商」(按协议 openai/anthropic),给每张详情图打类型。
// 图统一下载为 base64 再喂(两协议都稳);vision 不稳时本步可失败,如实记日志;类型后续支持人工纠正,不 mock。

import type { AppDataStore } from '@/lib/app/runtime/data-store';
import { getImageConcurrency, mapLimit } from './concurrency';
import { resolveVisionEndpoint, type VisionEndpoint } from './vision-provider';
import { visionChat } from './vision-chat';
import { loadImageAsBase64 } from './image-fetch';
import { logEvent } from './log';
import { COLLECTIONS, type DetailImageRow, type ImageType, type ProductRow } from './types';

const CLASSIFY_TIMEOUT_MS = 90_000; // 慢视觉模型(GPT-5 系经中转)60s 不够,给 90s
const CLASSIFY_ATTEMPTS = 2; // 超时/空内容多为偶发,重试 1 次能救回大部分
const CLASSIFY_MAX_CONCURRENCY = 2; // vision 中转扛不住高并发(易超时/限流),分类单独压到 ≤2,不跟图片生成的并发度

// 模型回中文词 → ImageType。命中关键词即归类,都不中=other。
const LABEL_RULES: Array<[RegExp, ImageType]> = [
  [/模特|场景|商品图|穿/, 'model_scene'],
  [/产品|平铺|单品|只有产品/, 'product'],
  [/尺码|尺寸|size|chart/i, 'size'],
  [/颜色|配色|色卡|color/i, 'color'],
];
function toImageType(raw: string): ImageType {
  const t = raw.trim();
  for (const [re, type] of LABEL_RULES) if (re.test(t)) return type;
  return 'other';
}

export interface ClassifyResult {
  ok: boolean;
  classified: number;
  failed: number;
  error?: string;
}

export async function classifyImages(
  store: AppDataStore,
  input: { userId: string; productId: string },
): Promise<ClassifyResult> {
  const vision = resolveVisionEndpoint(store);
  if (!vision.ok) return { ok: false, classified: 0, failed: 0, error: vision.error };
  const ep = vision.ep;

  const title = store.get<ProductRow>(COLLECTIONS.PRODUCTS, input.productId)?.title || input.productId;
  const imgs = store.query<DetailImageRow>(COLLECTIONS.IMAGES, { filter: { product_id: input.productId }, limit: 1000 });
  if (imgs.length === 0) return { ok: false, classified: 0, failed: 0, error: '该商品没有详情图' };

  const conc = Math.min(getImageConcurrency(store), CLASSIFY_MAX_CONCURRENCY);
  const outcomes = await mapLimit(imgs, conc, async (img) => {
    let lastErr = '';
    for (let attempt = 1; attempt <= CLASSIFY_ATTEMPTS; attempt++) {
      try {
        const type = await classifyOne(ep, img.image_url);
        store.update<DetailImageRow>(COLLECTIONS.IMAGES, img.id, { image_type: type });
        return true;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }
    logEvent('详情图分类', 'error', `图 ${img.id} 分类失败(${CLASSIFY_ATTEMPTS} 次): ${lastErr}`, title);
    return false;
  });
  const classified = outcomes.filter(Boolean).length;
  const failed = outcomes.length - classified;
  logEvent('详情图分类', failed > 0 ? 'warn' : 'info', `${classified} 成功 / ${failed} 失败`, title);
  return { ok: classified > 0, classified, failed };
}

const CLASSIFY_PROMPT = '只回一个词,这张电商详情图属于哪类:商品图(带模特或场景)、产品图(只有产品本身)、尺码图、颜色图、其他。';

async function classifyOne(ep: VisionEndpoint, imageUrl: string): Promise<ImageType> {
  if (!imageUrl) throw new Error('图缺 image_url');
  const img = await loadImageAsBase64({ url: imageUrl }); // 下载为 base64,两协议都能喂
  // max_tokens 给足 200:gemini-2.5-flash 等会先吐思考 token,太小(如 20)会在输出可见文字前耗光额度 → "无返回内容"。
  const content = await visionChat(ep, img, CLASSIFY_PROMPT, 200, CLASSIFY_TIMEOUT_MS);
  return toImageType(content);
}
