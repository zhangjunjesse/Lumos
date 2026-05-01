/**
 * Lightweight extension → MIME mapping for wechat file attachments.
 * Covers the office / common document formats we expect from WeChat users
 * (Word / Excel / PPT / PDF / archives / text). Unknown extensions get
 * application/octet-stream — the office MCP and Read tool can still pick the
 * file up by path.
 */

const EXT_MIME: Record<string, string> = {
  // Office
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.pdf': 'application/pdf',
  // Text
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.xml': 'application/xml',
  // Archives
  '.zip': 'application/zip',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
};

export function mimeFromFileName(name: string): string {
  const i = name.lastIndexOf('.');
  if (i < 0) return 'application/octet-stream';
  const ext = name.slice(i).toLowerCase();
  return EXT_MIME[ext] || 'application/octet-stream';
}

export function extensionFromMime(mime: string): string {
  for (const [ext, m] of Object.entries(EXT_MIME)) {
    if (m === mime) return ext;
  }
  return '';
}
