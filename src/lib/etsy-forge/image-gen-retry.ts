// 调图片服务商生成，网络层抖动(fetch failed / 连接重置 / 超时)时重试；非网络错误立即抛。
// 抠图/分析素材/抠姿势共用，避免各处重复。

import { generateImages } from '@/lib/image/generate';
import { logEvent } from './log';

const NETWORK_ERR = /fetch failed|network|ECONN|socket|timeout|terminated/i;

// 日志上下文:记清楚这次出图用了哪些图(可预览的 URL)、属于哪个商品。prompt 从 params 取。
// sources 是「可直接预览的图片 URL」(远程 url 或 /api/media/serve?path=…),日志里渲染成缩略图。
export interface GenLogCtx {
  product?: string;
  sources?: string[];
}

export async function generateImagesWithRetry(
  params: Parameters<typeof generateImages>[0],
  attempts = 3,
  scope = '图片生成',
  ctx?: GenLogCtx,
): ReturnType<typeof generateImages> {
  // 注入随机 seed：让每次调用的去重(in-flight dedupe)key 唯一。否则重试/重抠用相同参数，
  // 会被合并到之前那个已失败(已 abort 但 toapis 轮询还挂着)的请求上、立刻拿回"请求已取消"。
  // etsy 每次本就是独立生成，不该被去重合并。
  const seeded = { ...params, seed: params.seed ?? Math.floor(Math.random() * 1_000_000_000) };
  const product = ctx?.product;
  // 出图前先记一条「输入详情」:用了哪些图(走 images 字段渲染缩略图)+ 完整 prompt(message,UI 默认折叠)。
  if (ctx) {
    const srcs = ctx.sources ?? [];
    const promptStr = typeof params.prompt === 'string' ? params.prompt : '';
    logEvent(scope, 'info', `输入 · 用图 ${srcs.length} 张\nprompt:\n${promptStr}`, product, srcs);
  }
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await generateImages(seeded);
      logEvent(scope, 'info', `生成成功 (model=${r.model ?? '?'}, ${r.elapsedMs ?? '?'}ms, 第 ${i + 1} 次)`, product);
      return r;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // 本地超时取消：服务商在超时窗口内没出图(多半排队/限流/不支持此编辑)。重试无意义，给可操作的提示直接抛。
      if (/请求已取消|abort/i.test(msg)) {
        logEvent(scope, 'error', `生成失败(本地 10min 超时，服务商未返回): ${msg}`, product);
        throw new Error('图片服务商在 10 分钟内没返回结果（多半是排队/限流/不支持此次图像编辑）。建议：换「设置 → 图片生成」的服务商，或避免和别的生成同时跑、稍后单独重试。');
      }
      if (!NETWORK_ERR.test(msg)) {
        logEvent(scope, 'error', `生成失败: ${msg}`, product);
        throw e;
      }
      logEvent(scope, 'warn', `网络抖动，重试 ${i + 1}/${attempts}: ${msg}`, product);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  logEvent(scope, 'error', `生成失败(重试 ${attempts} 次耗尽): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`, product);
  throw lastErr;
}
