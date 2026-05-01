/**
 * Extract local image attachments from an AI-rendered markdown reply.
 *
 * lumos AI 在生成图片时把本地路径塞进 markdown image 引用，例如：
 *
 *   ![alt](/api/media/serve?path=%2FUsers%2Fme%2F.lumos%2F.lumos-media%2Fxxx.png)
 *   ![alt](/Users/me/.lumos/.lumos-media/xxx.png)
 *
 * 直接把这串 markdown 当文本发给微信 / 飞书 — 用户看到的是 markdown 字符串
 * 而不是图片。这里把每个内联图片读成 IMFileAttachment，从原文里剥掉对应的
 * markdown image 节点（保留 alt 作为简短说明），返回 cleanText + attachments
 * 给 sendToProvider。
 *
 * 安全：只接受路径在 .lumos-media / .codepilot-media（legacy）目录内，
 * 与 /api/media/serve 的安全策略一致。其它路径或网络 URL 不动。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { IMFileAttachment } from '@/lib/im';

const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const SERVE_PATH_RE = /^\/api\/media\/serve\?path=(.+)$/;
const ALLOWED_DIRS = ['.lumos-media', '.codepilot-media'];

const EXT_MIME: Record<string, string> = {
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
 * Resolve a markdown image url to an absolute filesystem path within the
 * lumos media directory. Returns null when the url is remote / unsupported /
 * outside the allowed sandbox.
 */
function resolveLumosMediaPath(url: string): string | null {
  let filePath = url;
  const serveMatch = SERVE_PATH_RE.exec(url);
  if (serveMatch) {
    try {
      filePath = decodeURIComponent(serveMatch[1]);
    } catch {
      return null;
    }
  }
  if (!filePath.startsWith('/')) return null;
  const resolved = path.resolve(filePath);
  if (!ALLOWED_DIRS.some((dir) => resolved.includes(`${path.sep}${dir}${path.sep}`))) {
    return null;
  }
  return resolved;
}

function readImageAttachment(absPath: string, idx: number): IMFileAttachment | null {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(absPath);
  } catch {
    return null;
  }
  if (bytes.length === 0) return null;
  const ext = path.extname(absPath).toLowerCase();
  const mime = EXT_MIME[ext] || 'application/octet-stream';
  if (!mime.startsWith('image/')) return null;
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
 * Walk markdown image references in `text`, materialize each one whose URL
 * resolves to a lumos-media file as an IMFileAttachment, and strip those
 * references out of the text. Remote URLs and non-resolvable paths are
 * preserved verbatim so non-multimedia IM channels still see the original link.
 */
export function extractInlineAttachments(text: string): ExtractResult {
  if (!text) return { cleanText: text, attachments: [] };
  const attachments: IMFileAttachment[] = [];
  let idx = 0;
  const cleanText = text.replace(MARKDOWN_IMAGE_RE, (whole, alt: string, url: string) => {
    const absPath = resolveLumosMediaPath(url.trim());
    if (!absPath) return whole; // leave remote / unresolvable refs as-is
    const attachment = readImageAttachment(absPath, idx);
    if (!attachment) return whole;
    attachments.push(attachment);
    idx += 1;
    const altText = (alt || '').trim();
    return altText ? `[图片: ${altText}]` : '[图片]';
  });
  return { cleanText: cleanText.replace(/\n{3,}/g, '\n\n').trim(), attachments };
}
