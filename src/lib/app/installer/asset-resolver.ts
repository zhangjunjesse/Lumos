import fs from 'fs';
import path from 'path';

/**
 * Resolve a requested asset URL path (split into segments) to an absolute
 * file path inside an installed app's directory, applying every safety
 * check we know about. Pure function on top of fs.lstatSync — extracted
 * from the assets route handler so it can be exercised by unit tests
 * without spinning up Next.js.
 *
 * Rules (all enforced):
 *   - At least one segment must be supplied.
 *   - No segment may be empty, '.', '..', start with '.', contain a path
 *     separator (forward or back) or any of `<>|?* `.
 *   - The first segment must be either:
 *       - one of ALLOWED_TOP_LEVEL_FILES, when it's the only segment, or
 *       - one of ALLOWED_TOP_LEVEL_DIRS, when there are more segments.
 *   - REJECTED_TOP_LEVEL_DIRS (components/, .history/, .git/, node_modules/)
 *     always fail, even when in the allowed-dir list, by listing them
 *     ahead.
 *   - The resolved path must equal install_path or sit strictly under it.
 *   - The target must exist, must NOT be a symlink, and must be a regular
 *     file (lstat is used so symlinks don't traverse).
 *   - The target's size must be ≤ maxBytes.
 *
 * Failure modes are all merged into a single { ok: false, reason } shape
 * so the caller can deliberately collapse them into 404 responses without
 * leaking the distinction between "not allowed" and "missing".
 */

export const ALLOWED_TOP_LEVEL_FILES = new Set([
  'app.json',
  'routes.json',
  'data-schema.json',
  'icon.png',
]);
export const ALLOWED_TOP_LEVEL_DIRS = new Set([
  'pages',
  'workflows',
  'locales',
  'assets',
]);
export const REJECTED_TOP_LEVEL_DIRS = new Set([
  'components', // M6+
  '.history',
  '.git',
  'node_modules',
]);

export type AssetResolveOk = {
  ok: true;
  absolutePath: string;
  size: number;
};

export type AssetResolveError = {
  ok: false;
  reason:
    | 'EmptyPath'
    | 'BadSegment'
    | 'TopFileNotAllowed'
    | 'TopDirRejected'
    | 'TopDirNotAllowed'
    | 'OutsideRoot'
    | 'NotFound'
    | 'IsDirectory'
    | 'IsSymlink'
    | 'TooLarge';
};

export type AssetResolveResult = AssetResolveOk | AssetResolveError;

const SEGMENT_FORBIDDEN = /[<>|?* ]/;

export function resolveAssetPath(
  installRoot: string,
  segments: string[],
  opts: { maxBytes?: number } = {},
): AssetResolveResult {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { ok: false, reason: 'EmptyPath' };
  }

  for (const seg of segments) {
    if (
      typeof seg !== 'string' ||
      seg === '' ||
      seg === '.' ||
      seg === '..' ||
      seg.startsWith('.') ||
      seg.includes('\\') ||
      seg.includes('/') ||
      SEGMENT_FORBIDDEN.test(seg)
    ) {
      return { ok: false, reason: 'BadSegment' };
    }
  }

  const top = segments[0];

  // Reject explicit top-level dirs first, before allow-listing.
  if (segments.length > 1 && REJECTED_TOP_LEVEL_DIRS.has(top)) {
    return { ok: false, reason: 'TopDirRejected' };
  }

  if (segments.length === 1) {
    if (!ALLOWED_TOP_LEVEL_FILES.has(top)) {
      return { ok: false, reason: 'TopFileNotAllowed' };
    }
  } else if (!ALLOWED_TOP_LEVEL_DIRS.has(top)) {
    return { ok: false, reason: 'TopDirNotAllowed' };
  }

  const root = path.resolve(installRoot);
  const requested = path.resolve(root, ...segments);
  if (requested !== root && !requested.startsWith(root + path.sep)) {
    return { ok: false, reason: 'OutsideRoot' };
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(requested);
  } catch {
    return { ok: false, reason: 'NotFound' };
  }
  if (stat.isSymbolicLink()) return { ok: false, reason: 'IsSymlink' };
  if (stat.isDirectory()) return { ok: false, reason: 'IsDirectory' };
  if (!stat.isFile()) return { ok: false, reason: 'NotFound' };

  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  if (stat.size > maxBytes) return { ok: false, reason: 'TooLarge' };

  return { ok: true, absolutePath: requested, size: stat.size };
}
