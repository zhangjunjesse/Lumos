/**
 * Extract attachments from an AI-rendered markdown reply.
 *
 * lumos AI 把生成的本地文件路径塞进 markdown 引用：
 *
 *   ![alt](/api/media/serve?path=%2FUsers%2Fme%2F.lumos%2F.lumos-media%2Fxxx.png)   图片
 *   ![alt](/Users/me/.lumos/.lumos-media/xxx.png)                                   图片直接路径
 *   [report.docx](/Users/me/.lumos/.lumos-uploads/report.docx)                     普通链接
 *
 * 直接把这串 markdown 当文本发给微信 / 飞书 — 用户看到一串路径字符串或 URL，
 * 不是图片或文件。这里把每个能解析到 lumos 沙箱内的引用读成 IMFileAttachment，
 * 对远程图片 URL 也会做小尺寸下载并转为图片附件。
 * 从原文里剥掉对应的 markdown 节点（保留描述文字作为占位），返回 cleanText +
 * attachments 给 sendToProvider。
 *
 * 安全：只接受路径在 .lumos-media / .lumos-uploads / .codepilot-* 目录内，
 * 与 /api/media/serve / /api/uploads 的策略一致。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { IMFileAttachment } from '@/lib/im';

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
// 普通 markdown link：和 image 区分用前面没有 `!`。在 replace 流里我们先吃掉 image，
// 再用这个 regex 处理剩余的链接。开头加 `(?<!\!)` 防止匹配到刚被替换的 image。
const MARKDOWN_LINK_RE = /(?<!\!)\[([^\]]+)\]\(([^)]+)\)/g;
const BARE_IMAGE_URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;
const SERVE_PATH_RE = /^\/api\/media\/serve\?path=(.+)$/;
const UPLOADS_API_RE = /^\/api\/uploads\?path=(.+)$/;
const MAX_REMOTE_IMAGE_BYTES = 15 * 1024 * 1024;
const REMOTE_FETCH_TIMEOUT_MS = 15_000;
const ALLOWED_DIRS = [
  '.lumos-media',
  '.lumos-uploads',
  '.lumos-images',
  '.codepilot-media',
  '.codepilot-uploads',
  '.codepilot-images',
];

const EXT_MIME: Record<string, string> = {
  // images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  // office
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pdf': 'application/pdf',
  // text / data
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  // archives
  '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
};

const IMAGE_EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export interface ExtractResult {
  cleanText: string;
  attachments: IMFileAttachment[];
}

/**
 * Resolve a markdown URL to an absolute filesystem path within the lumos
 * sandbox (.lumos-media / .lumos-uploads / .lumos-images / .codepilot-*).
 * Returns null for remote URLs, unresolvable paths, or paths outside the
 * sandbox.
 *
 * Accepts:
 *   - /api/media/serve?path=ENCODED_ABS_PATH   (image-gen tool URL)
 *   - /api/uploads?path=ENCODED_ABS_PATH       (file uploads URL)
 *   - /abs/path/file.ext                       (direct absolute path)
 */
function resolveLumosSandboxPath(url: string): string | null {
  let filePath = url;
  const serveMatch = SERVE_PATH_RE.exec(url);
  if (serveMatch) {
    try { filePath = decodeURIComponent(serveMatch[1]); } catch { return null; }
  } else {
    const uploadsMatch = UPLOADS_API_RE.exec(url);
    if (uploadsMatch) {
      try { filePath = decodeURIComponent(uploadsMatch[1]); } catch { return null; }
    }
  }
  // path.isAbsolute is platform-aware: recognises `/abs/foo` on POSIX and
  // `C:\Users\...` (+ `\\server\share`) on Windows. The previous check —
  // `filePath.startsWith('/')` — silently rejected every Windows absolute
  // path, which is what surfaced as the "filePath not allowed" error when
  // an IM agent tried to attach a Word/PDF generated under
  // `C:\Users\<user>\.lumos\.lumos-uploads\`.
  if (!path.isAbsolute(filePath)) return null;
  const resolved = path.resolve(filePath);
  if (!ALLOWED_DIRS.some((dir) => resolved.includes(`${path.sep}${dir}${path.sep}`))) {
    return null;
  }
  return resolved;
}

function readSandboxAttachment(
  absPath: string,
  idx: number,
  expectImage: boolean,
): IMFileAttachment | null {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(absPath);
  } catch {
    return null;
  }
  if (bytes.length === 0) return null;
  const ext = path.extname(absPath).toLowerCase();
  const mime = EXT_MIME[ext] || 'application/octet-stream';
  if (expectImage && !mime.startsWith('image/')) return null;
  const baseName = path.basename(absPath);
  return {
    id: `inline-${idx}-${baseName}`,
    name: baseName,
    type: mime,
    size: bytes.length,
    data: bytes.toString('base64'),
    filePath: absPath,
  };
}

/**
 * Walk markdown image **and** link references in `text`, materialize each one
 * that resolves to a lumos sandbox file as an IMFileAttachment, and strip those
 * references out of the text. Remote URLs and non-resolvable paths are
 * preserved verbatim so the IM channel still sees the original markup.
 *
 *   ![alt](url)         → image attachment（仅 image/* MIME 接受）
 *   [label](url)        → 其它文件 attachment（office / pdf / zip / 其他二进制）
 */
export function extractInlineAttachments(text: string): ExtractResult {
  return extractLocalInlineAttachments(text);
}

export async function extractInlineAttachmentsForIm(text: string): Promise<ExtractResult> {
  const local = extractLocalInlineAttachments(text);
  return extractRemoteImages(local.cleanText, local.attachments);
}

function extractLocalInlineAttachments(text: string): ExtractResult {
  if (!text) return { cleanText: text, attachments: [] };
  const attachments: IMFileAttachment[] = [];
  let idx = 0;

  // 1) 先处理 markdown image — 强制要求 image/* MIME，否则保留 markdown
  let cleanText = text.replace(MARKDOWN_IMAGE_RE, (whole, alt: string, url: string) => {
    const absPath = resolveLumosSandboxPath(url.trim());
    if (!absPath) return whole;
    const attachment = readSandboxAttachment(absPath, idx, true);
    if (!attachment) return whole;
    attachments.push(attachment);
    idx += 1;
    const altText = (alt || '').trim();
    return altText ? `[图片: ${altText}]` : '[图片]';
  });

  // 2) 再处理 markdown link — 接受任何 MIME（office / pdf / 其它二进制）
  cleanText = cleanText.replace(MARKDOWN_LINK_RE, (whole, label: string, url: string) => {
    const absPath = resolveLumosSandboxPath(url.trim());
    if (!absPath) return whole;
    const attachment = readSandboxAttachment(absPath, idx, false);
    if (!attachment) return whole;
    attachments.push(attachment);
    idx += 1;
    const labelText = (label || '').trim() || attachment.name;
    return `[文件: ${labelText}]`;
  });

  return { cleanText: cleanText.replace(/\n{3,}/g, '\n\n').trim(), attachments };
}

async function extractRemoteImages(text: string, existing: IMFileAttachment[]): Promise<ExtractResult> {
  if (!text || !/\bhttps?:\/\//i.test(text)) {
    return { cleanText: text, attachments: existing };
  }

  const attachments = [...existing];
  let idx = attachments.length;

  let cleanText = await replaceAsync(text, MARKDOWN_IMAGE_RE, async (whole, alt: string, url: string) => {
    const remote = await downloadRemoteImage(url.trim(), idx, { allowUnknownPath: true });
    if (!remote) return whole;
    attachments.push(remote);
    idx += 1;
    const altText = (alt || '').trim();
    return altText ? `[图片: ${altText}]` : '[图片]';
  });

  cleanText = await replaceAsync(cleanText, MARKDOWN_LINK_RE, async (whole, label: string, url: string) => {
    const remote = await downloadRemoteImage(url.trim(), idx, { allowUnknownPath: false });
    if (!remote) return whole;
    attachments.push(remote);
    idx += 1;
    const labelText = (label || '').trim();
    return labelText ? `[图片: ${labelText}]` : `[图片: ${remote.name}]`;
  });

  cleanText = await replaceAsync(cleanText, BARE_IMAGE_URL_RE, async (whole) => {
    const remote = await downloadRemoteImage(trimTrailingUrlPunctuation(whole), idx, { allowUnknownPath: false });
    if (!remote) return whole;
    attachments.push(remote);
    idx += 1;
    return `[图片: ${remote.name}]`;
  });

  return { cleanText: cleanText.replace(/\n{3,}/g, '\n\n').trim(), attachments };
}

async function replaceAsync(
  input: string,
  regex: RegExp,
  replacer: (whole: string, ...groups: string[]) => Promise<string>,
): Promise<string> {
  const parts: string[] = [];
  let lastIndex = 0;
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  for (const match of input.matchAll(re)) {
    const index = match.index ?? 0;
    parts.push(input.slice(lastIndex, index));
    parts.push(await replacer(match[0], ...match.slice(1)));
    lastIndex = index + match[0].length;
  }
  parts.push(input.slice(lastIndex));
  return parts.join('');
}

async function downloadRemoteImage(
  rawUrl: string,
  idx: number,
  options: { allowUnknownPath: boolean },
): Promise<IMFileAttachment | null> {
  const parsed = parseRemoteImageUrl(rawUrl, options);
  if (!parsed) return null;

  try {
    const res = await fetch(parsed.url.toString(), {
      method: 'GET',
      signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.1',
      },
    });
    if (!res.ok) return null;
    const declaredLength = Number.parseInt(res.headers.get('content-length') || '', 10);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REMOTE_IMAGE_BYTES) return null;

    const contentType = normalizeImageMime(res.headers.get('content-type') || '') || parsed.mime;
    if (!contentType?.startsWith('image/')) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_REMOTE_IMAGE_BYTES) return null;
    const mime = normalizeImageMime(contentType) || detectImageMimeFromBytes(buffer) || parsed.mime;
    if (!mime?.startsWith('image/')) return null;

    const ext = extensionForMime(mime) || parsed.ext || '.img';
    const name = safeRemoteFileName(parsed.url, ext);
    return {
      id: `remote-image-${idx}-${Date.now()}`,
      name,
      type: mime,
      size: buffer.length,
      data: buffer.toString('base64'),
    };
  } catch {
    return null;
  }
}

function parseRemoteImageUrl(
  rawUrl: string,
  options: { allowUnknownPath: boolean },
): { url: URL; mime?: string; ext?: string } | null {
  let url: URL;
  try {
    url = new URL(trimTrailingUrlPunctuation(rawUrl));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (isBlockedRemoteHost(url.hostname)) return null;
  const ext = path.extname(decodeURIComponent(url.pathname)).toLowerCase();
  const mime = IMAGE_EXT_MIME[ext];
  if (!mime && !url.pathname.includes('/api/media/serve') && !options.allowUnknownPath) {
    // Avoid fetching arbitrary web pages unless the URL at least looks like an
    // image. Generated-image URLs from Lumos itself are local paths, not remote.
    return null;
  }
  return { url, mime, ext: mime ? ext : undefined };
}

function isBlockedRemoteHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  const parts = host.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return a === 10
    || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254)
    || (a === 100 && b >= 64 && b <= 127)
    || a === 0;
}

function trimTrailingUrlPunctuation(value: string): string {
  return value.replace(/[.,，。!！?？;；:：]+$/g, '');
}

function normalizeImageMime(value: string): string | null {
  const type = value.split(';')[0].trim().toLowerCase();
  return type.startsWith('image/') ? type : null;
}

function detectImageMimeFromBytes(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'image/png';
  if (bytes.length >= 6) {
    const head = bytes.subarray(0, 6).toString('ascii');
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';
  return null;
}

function extensionForMime(mime: string): string | null {
  switch (mime) {
    case 'image/png': return '.png';
    case 'image/jpeg': return '.jpg';
    case 'image/webp': return '.webp';
    case 'image/gif': return '.gif';
    default: return null;
  }
}

function safeRemoteFileName(url: URL, ext: string): string {
  const rawBase = path.basename(decodeURIComponent(url.pathname)).replace(/\.[^.]+$/, '');
  const cleaned = rawBase.replace(/[/\\\0\r\n]/g, '_').replace(/^\.+/, '').slice(0, 80);
  return `${cleaned || 'image'}${ext}`;
}
