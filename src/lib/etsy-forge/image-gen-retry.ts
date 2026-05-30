// 调图片服务商生成，网络层抖动(fetch failed / 连接重置 / 超时)时重试；非网络错误立即抛。
// 抠图/分析素材/抠姿势共用，避免各处重复。

import { generateImages } from '@/lib/image/generate';

const NETWORK_ERR = /fetch failed|network|ECONN|socket|timeout|terminated/i;

export async function generateImagesWithRetry(
  params: Parameters<typeof generateImages>[0],
  attempts = 3,
): ReturnType<typeof generateImages> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await generateImages(params);
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!NETWORK_ERR.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}
