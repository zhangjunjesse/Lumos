/**
 * File type categorization for preview system
 * Maps file extensions to preview categories
 */

export type FileCategory =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'text';

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac']);
const PDF_EXTS = new Set(['.pdf']);
const WORD_EXTS = new Set(['.docx', '.doc']);
const EXCEL_EXTS = new Set(['.xlsx', '.xls', '.csv']);
const POWERPOINT_EXTS = new Set(['.pptx', '.ppt']);

// Extensions that should not be previewed at all
const NON_PREVIEWABLE_EXTS = new Set([
  '.zip', '.tar', '.gz', '.rar', '.7z',
  '.exe', '.dll', '.so', '.dylib',
  '.ttf', '.otf', '.woff', '.woff2',
  '.bin', '.dat', '.db', '.sqlite',
]);

/**
 * Get file extension from path
 */
function getExtension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot).toLowerCase() : '';
}

/**
 * Determine file category for preview
 */
export function getFileCategory(path: string): FileCategory | null {
  const ext = getExtension(path);

  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (WORD_EXTS.has(ext)) return 'word';
  if (EXCEL_EXTS.has(ext)) return 'excel';
  if (POWERPOINT_EXTS.has(ext)) return 'powerpoint';
  if (NON_PREVIEWABLE_EXTS.has(ext)) return null;

  return 'text'; // Default to text for unknown extensions
}

/**
 * Check if file can be previewed
 */
export function isPreviewable(path: string): boolean {
  return getFileCategory(path) !== null;
}

/**
 * Get MIME type for file extension
 */
export function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    // Images
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    // Videos
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    // Audio
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    // Documents
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.ppt': 'application/vnd.ms-powerpoint',
  };

  return mimeMap[ext.toLowerCase()] || 'application/octet-stream';
}

/**
 * Get file URL for preview (Electron uses file://, browser uses API)
 */
export function getFileUrl(path: string, baseDir?: string): string {
  // In Electron, use file:// protocol
  if (typeof window !== 'undefined' && (window as any).electron) {
    return `file://${path}`;
  }

  // In browser, use API endpoint
  const params = new URLSearchParams({ path });
  if (baseDir) params.set('baseDir', baseDir);
  return `/api/files/raw?${params.toString()}`;
}
