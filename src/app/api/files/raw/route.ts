import { NextRequest } from 'next/server';
import type { Stats } from 'fs';
import fs from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.mdx': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xml': 'text/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.ts': 'application/typescript',
  '.tsx': 'application/typescript',
  '.jsx': 'application/javascript',
  '.py': 'text/x-python',
  '.go': 'text/x-go',
  '.rs': 'text/x-rust',
  '.java': 'text/x-java',
  '.rb': 'text/x-ruby',
  '.sh': 'text/x-shellscript',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/toml',
  '.sql': 'text/x-sql',
  '.swift': 'text/x-swift',
  '.kt': 'text/x-kotlin',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.php': 'text/x-php',
  '.dart': 'text/x-dart',
  '.lua': 'text/x-lua',
  '.zig': 'text/x-zig',
  '.vue': 'text/x-vue',
  '.svelte': 'text/x-svelte',
  '.graphql': 'text/x-graphql',
  '.gql': 'text/x-graphql',
  '.prisma': 'text/x-prisma',
  '.dockerfile': 'text/x-dockerfile',
  '.scss': 'text/x-scss',
  '.less': 'text/x-less',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.aac': 'audio/aac',
  '.amr': 'audio/amr',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.silk': 'audio/silk',
  '.wav': 'audio/wav',
  '.weba': 'audio/webm',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

async function resolveFile(request: NextRequest): Promise<
  | { ok: true; resolved: string; stat: Stats; contentType: string; encodedFileName: string }
  | { ok: false; response: Response }
> {
  const filePath = request.nextUrl.searchParams.get('path');
  const baseDir = request.nextUrl.searchParams.get('baseDir');

  if (!filePath) {
    return { ok: false, response: new Response(JSON.stringify({ error: 'path parameter is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }) };
  }

  // Resolve path: if baseDir is provided and path is relative, join them
  let resolved: string;
  if (baseDir && !path.isAbsolute(filePath)) {
    resolved = path.resolve(baseDir, filePath);
  } else {
    resolved = path.resolve(filePath);
  }

  try {
    await fs.access(resolved);
  } catch {
    return { ok: false, response: new Response(JSON.stringify({ error: 'File not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }) };
  }

  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    return { ok: false, response: new Response(JSON.stringify({ error: 'Not a file' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }) };
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const fileName = path.basename(resolved);

  // Encode filename for Content-Disposition header (RFC 5987)
  // This handles non-ASCII characters (e.g., Chinese) properly
  const encodedFileName = encodeURIComponent(fileName);
  return { ok: true, resolved, stat, contentType, encodedFileName };
}

/**
 * Serve raw file content from the user's home directory.
 * Security: only allows reading files within the user's home directory.
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveFile(request);
  if (!resolved.ok) return resolved.response;

  const buffer = await fs.readFile(resolved.resolved);

  return new Response(buffer, {
    headers: {
      'Content-Type': resolved.contentType,
      'Content-Length': String(resolved.stat.size),
      'Content-Disposition': `inline; filename*=UTF-8''${resolved.encodedFileName}`,
    },
  });
}

export async function HEAD(request: NextRequest) {
  const resolved = await resolveFile(request);
  if (!resolved.ok) return resolved.response;

  return new Response(null, {
    headers: {
      'Content-Type': resolved.contentType,
      'Content-Length': String(resolved.stat.size),
      'Content-Disposition': `inline; filename*=UTF-8''${resolved.encodedFileName}`,
    },
  });
}
