/**
 * Sandbox path + MIME helpers shared by:
 *   - extract-inline-attachments (parsing AI markdown)
 *   - /api/im/tool (im_send_attachment from agents)
 *
 * Only files inside lumos's known data directories are allowed to be sent
 * outbound by tools. This is the same rule /api/uploads enforces for serving.
 */

import path from 'node:path';
import os from 'node:os';

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
 * sandbox. Returns null if relative, outside sandbox, or missing an allowed dir.
 *
 * Uses path.isAbsolute (not a `/`-prefix test) so Windows `C:\...` paths pass,
 * and expands a leading `~`. pathImpl/homeDir are injected only so both
 * platforms can be unit-tested on a single OS.
 */
export function resolveLumosSandboxPath(
  input: string,
  opts: { pathImpl?: typeof path; homeDir?: string } = {},
): string | null {
  if (!input) return null;
  const p = opts.pathImpl ?? path;
  const home = opts.homeDir ?? os.homedir();
  const expanded = expandTilde(input, p, home);
  if (!p.isAbsolute(expanded)) return null;
  const resolved = p.resolve(expanded);
  if (!ALLOWED_DIRS.some((dir) => resolved.includes(`${p.sep}${dir}${p.sep}`))) {
    return null;
  }
  return resolved;
}

function expandTilde(input: string, p: typeof path, homeDir: string): string {
  if (input === '~') return homeDir;
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    return p.join(homeDir, input.slice(2));
  }
  return input;
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
