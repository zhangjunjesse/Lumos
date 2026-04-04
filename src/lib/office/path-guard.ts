import os from 'os';
import path from 'path';

/**
 * Allowed root directories for Office document operations.
 * Prevents path traversal attacks by restricting file access to:
 * - User home directory and subdirectories
 * - /tmp (for temporary processing)
 */
function getAllowedRoots(): string[] {
  const home = os.homedir();
  const dataDir = process.env.LUMOS_DATA_DIR
    || process.env.CLAUDE_GUI_DATA_DIR
    || path.join(home, '.lumos');

  return [
    home,
    dataDir,
    os.tmpdir(),
    '/tmp',
  ].map((p) => path.resolve(p));
}

export function assertSafePath(filePath: string): string {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path is required');
  }

  const resolved = path.resolve(filePath);
  const roots = getAllowedRoots();
  const isSafe = roots.some((root) => resolved.startsWith(root + path.sep) || resolved === root);

  if (!isSafe) {
    throw new Error(`Access denied: path "${filePath}" is outside allowed directories`);
  }

  return resolved;
}
