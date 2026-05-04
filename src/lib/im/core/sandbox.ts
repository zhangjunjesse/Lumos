/**
 * Sandbox path + MIME helpers shared by:
 *   - extract-inline-attachments (parsing AI markdown)
 *   - /api/im/tool (im_send_attachment from agents)
 *
 * Only files inside lumos's known data directories are allowed to be sent
 * outbound by tools. This is the same rule /api/uploads enforces for serving.
 */

import path from 'node:path';

const ALLOWED_DIRS = [
  '.lumos-media',
  '.lumos-uploads',
  '.lumos-images',
  '.codepilot-media',
  '.codepilot-uploads',
  '.codepilot-images',
];

/**
 * Resolve a user / agent-supplied path to an absolute path inside the lumos
 * sandbox. Returns null if the path is relative, traverses outside sandbox,
 * or doesn't include any allowed directory segment.
 */
export function resolveLumosSandboxPath(input: string): string | null {
  if (!input || !input.startsWith('/')) return null;
  const resolved = path.resolve(input);
  if (!ALLOWED_DIRS.some((dir) => resolved.includes(`${path.sep}${dir}${path.sep}`))) {
    return null;
  }
  return resolved;
}

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
  '.html': 'text/html',
  // archives
  '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
};

export function mimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_MIME[ext] || 'application/octet-stream';
}
