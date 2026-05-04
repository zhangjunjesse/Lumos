/**
 * Extract local file attachments (images + office docs) from an AI-rendered
 * markdown reply.
 *
 * lumos AI 把生成的本地文件路径塞进 markdown 引用：
 *
 *   ![alt](/api/media/serve?path=%2FUsers%2Fme%2F.lumos%2F.lumos-media%2Fxxx.png)   图片
 *   ![alt](/Users/me/.lumos/.lumos-media/xxx.png)                                   图片直接路径
 *   [report.docx](/Users/me/.lumos/.lumos-uploads/report.docx)                     普通链接
 *
 * 直接把这串 markdown 当文本发给微信 / 飞书 — 用户看到一串路径字符串而不
 * 是图片或文件。这里把每个能解析到 lumos 沙箱内的引用读成 IMFileAttachment，
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
const SERVE_PATH_RE = /^\/api\/media\/serve\?path=(.+)$/;
const UPLOADS_API_RE = /^\/api\/uploads\?path=(.+)$/;
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
  if (!filePath.startsWith('/')) return null;
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
