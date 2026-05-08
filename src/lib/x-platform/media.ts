/**
 * X (Twitter) 媒体上传。
 *
 * x.com web app 走 https://upload.x.com/i/media/upload.json (legacy v1.1 API),
 * 带和 GraphQL 同样的 bearer + ct0 + cookies。两种模式:
 *   - simple: 一次性上传, 适合 <= 5MB 图片。我们 v1 只支持这种。
 *   - chunked (INIT/APPEND/FINALIZE): 视频和大文件, v2 再加。
 *
 * 拿到 media_id_string 后, 在 CreateTweet variables.media.media_entities 里
 * 带上, 推文就会带这张图。一条推最多 4 张图。
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { XAuthExpiredError } from './auth-error';
import { cookieHeader, hasRequiredCookies, readCookies } from './cookies-store';

const WEB_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const UPLOAD_URL = 'https://upload.x.com/i/media/upload.json';

const MAX_SIMPLE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
]);

export interface UploadInput {
  /** 二进制内容。 */
  data: Buffer;
  /** MIME, 如 image/png。 */
  mimeType: string;
  /** 文件名仅用于 form multipart, 服务器不依赖。 */
  filename?: string;
}

function buildAuthHeaders(): Record<string, string> {
  const stored = readCookies();
  if (!stored || !hasRequiredCookies(stored.cookies)) {
    throw new XAuthExpiredError('X 未登录或 cookie 已丢失');
  }
  return {
    'authorization': `Bearer ${WEB_BEARER}`,
    'x-csrf-token': stored.cookies.ct0,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'cookie': cookieHeader(stored.cookies),
    'user-agent': DESKTOP_UA,
    'origin': 'https://x.com',
    'referer': 'https://x.com/',
  };
}

export async function uploadImage(input: UploadInput): Promise<string> {
  if (!ALLOWED_MIME.has(input.mimeType)) {
    throw new Error(`不支持的图片格式: ${input.mimeType}, 仅支持 jpeg/png/gif/webp`);
  }
  if (input.data.length > MAX_SIMPLE_BYTES) {
    throw new Error(`图片超过 5MB (当前 ${(input.data.length / 1024 / 1024).toFixed(1)}MB), 视频/大图请等 v2 chunked 上传`);
  }

  const form = new FormData();
  form.append('media_data', input.data.toString('base64'));
  form.append('media_category', 'tweet_image');

  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: buildAuthHeaders(),
    body: form,
  });
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new XAuthExpiredError(`X media upload HTTP ${res.status}`);
  }
  let data: { media_id_string?: string; errors?: Array<{ message?: string }> };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`X media upload 非 JSON 响应 (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (data?.errors?.length) {
    throw new Error(`X media upload 失败: ${data.errors.map((e) => e?.message || '?').join('; ')}`);
  }
  if (!data?.media_id_string) {
    throw new Error(`X media upload 响应缺 media_id_string: ${text.slice(0, 200)}`);
  }
  return data.media_id_string;
}

/**
 * 从本地文件路径上传, MCP 工具的 mediaPaths 走这里。MIME 通过扩展名推断,
 * 不依赖 file 命令(避免外部 binary)。
 */
export async function uploadImageFromPath(filePath: string): Promise<string> {
  if (!existsSync(filePath)) throw new Error(`文件不存在: ${filePath}`);
  const stat = statSync(filePath);
  if (!stat.isFile()) throw new Error(`不是文件: ${filePath}`);
  if (stat.size > MAX_SIMPLE_BYTES) {
    throw new Error(`文件超过 5MB (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
  }
  const data = readFileSync(filePath);
  const mimeType = inferMime(filePath);
  return uploadImage({ data, mimeType, filename: filePath.split(/[\\/]/).pop() });
}

function inferMime(filePath: string): string {
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    default: throw new Error(`无法识别图片扩展名: .${ext}`);
  }
}
