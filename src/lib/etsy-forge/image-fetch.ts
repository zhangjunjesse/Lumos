// 图片下载/读取（喂给图片服务商作参考）。
// 服务端访问 etsystatic 慢(~7s/张)且时有超时,所以:
//   1) 采详情图时 downloadImageToLocal 落地到本地(.lumos-media),只下一次;
//   2) 之后抠图/素材通过 loadImageAsBase64 优先读本地文件(快),没有才回退下 URL;
//   3) 批量下载带重试 + 容错(部分成功就用)。

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

const DATA_DIR = process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos');
const MEDIA_DIR = path.join(DATA_DIR, '.lumos-media');

export interface FetchedImage {
  mimeType: string;
  data: string;
}

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

/** 把远程图下载落地到 .lumos-media，返回本地绝对路径；失败抛错。 */
export async function downloadImageToLocal(url: string, opts: { timeoutMs?: number } = {}): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000) });
  if (!res.ok) throw new Error(`下载图失败 HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || 'image/jpeg';
  const ext = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const filePath = path.join(MEDIA_DIR, `etsy-src-${randomUUID()}${ext}`);
  await fs.writeFile(filePath, Buffer.from(await res.arrayBuffer()));
  return filePath;
}

/** 把内存图 buffer(如整店首页截图)落地到 .lumos-media，返回本地绝对路径。 */
export async function saveImageBufferToLocal(buf: Buffer, ext = '.png'): Promise<string> {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const filePath = path.join(MEDIA_DIR, `etsy-shop-${randomUUID()}${ext}`);
  await fs.writeFile(filePath, buf);
  return filePath;
}

/** 读取一张图为 base64：有本地文件优先读本地，否则带重试下 URL。 */
export async function loadImageAsBase64(
  ref: { localPath?: string | null; url: string },
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<FetchedImage> {
  if (ref.localPath) {
    try {
      const buf = await fs.readFile(ref.localPath);
      const ext = path.extname(ref.localPath).toLowerCase();
      return { mimeType: EXT_MIME[ext] || 'image/jpeg', data: buf.toString('base64') };
    } catch {
      /* 本地文件丢了 → 回退下 URL */
    }
  }
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(ref.url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || 'image/jpeg';
      const buf = Buffer.from(await res.arrayBuffer());
      return { mimeType: ct.startsWith('image/') ? ct : 'image/jpeg', data: buf.toString('base64') };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`下载图失败(重试 ${retries} 次): ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}

/** 批量读取(本地优先 + 容错)：返回所有成功的，全失败才抛错。 */
export async function loadImagesBestEffort(
  refs: { localPath?: string | null; url: string }[],
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<FetchedImage[]> {
  const settled = await Promise.allSettled(refs.map((r) => loadImageAsBase64(r, opts)));
  const ok = settled.filter((r): r is PromiseFulfilledResult<FetchedImage> => r.status === 'fulfilled').map((r) => r.value);
  if (ok.length === 0) throw new Error('所有商品图都读取失败（本地无缓存且 etsystatic 下载超时，稍后重试）');
  return ok;
}
