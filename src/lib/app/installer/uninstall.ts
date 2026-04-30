import fs from 'fs';
import path from 'path';

import type {
  UninstallContext,
  UninstallOptions,
  UninstallResult,
} from './types';

/**
 * Uninstall an installed app.
 *
 * Default behavior:
 *   - Delete the lumos_app_apps row (CASCADE removes configs, permissions,
 *     triggers, runs).
 *   - Remove the install dir from disk.
 *   - **Keep** user data in lumos_app_data — this matches the requirements
 *     (§3 MVP, "uninstall offers keep-data option") and lets a reinstall
 *     of the same app id reconnect to the prior dataset.
 *
 * Pass keepData: false to also purge lumos_app_data rows.
 */
export async function uninstallApp(
  appId: string,
  ctx: UninstallContext,
  opts: UninstallOptions = {},
): Promise<UninstallResult> {
  const keepData = opts.keepData ?? true;
  const purgePrevious = opts.purgePrevious ?? true;

  const row = ctx.db
    .prepare(
      `SELECT id, install_path, previous_install_path
       FROM lumos_app_apps WHERE id = ?`,
    )
    .get(appId) as
    | { id: string; install_path: string; previous_install_path: string | null }
    | undefined;

  if (!row) {
    return {
      ok: false,
      error: 'NotInstalled',
      message: `App '${appId}' is not installed`,
    };
  }

  // Database side first — if the FS removal then fails, the user can retry
  // and we won't get stuck with an installed-but-missing-files state.
  let deletedDataRows = 0;
  try {
    ctx.db.exec('BEGIN');

    // CASCADE will remove configs, permissions, runs, triggers (but NOT
    // lumos_app_data, which has no FK by design — see migrations-app.ts).
    ctx.db.prepare(`DELETE FROM lumos_app_apps WHERE id = ?`).run(appId);

    if (!keepData) {
      const info = ctx.db
        .prepare(`DELETE FROM lumos_app_data WHERE app_id = ?`)
        .run(appId);
      deletedDataRows = Number(info.changes);
    }

    ctx.db.exec('COMMIT');
  } catch (err) {
    try {
      ctx.db.exec('ROLLBACK');
    } catch {
      // already rolled back
    }
    return {
      ok: false,
      error: 'FilesystemError',
      message: `Database write failed: ${(err as Error).message}`,
    };
  }

  // Filesystem side. Best-effort: any path that fails to remove is reported
  // but does not undo the DB delete (we'd rather leave orphan files than
  // refuse to uninstall over a permission glitch).
  const deletedPaths: string[] = [];
  for (const p of [
    row.install_path,
    purgePrevious ? row.previous_install_path : null,
  ]) {
    if (!p) continue;
    try {
      if (fs.existsSync(p)) {
        fs.rmSync(p, { recursive: true, force: true });
        deletedPaths.push(p);
      }
    } catch {
      // ignore — orphan files are recoverable manually
    }
  }

  // If the per-app install root (.../{id}/) is now empty, remove it too.
  const installRoot = path.dirname(row.install_path);
  try {
    if (fs.existsSync(installRoot) && fs.readdirSync(installRoot).length === 0) {
      fs.rmdirSync(installRoot);
      deletedPaths.push(installRoot);
    }
  } catch {
    // ignore
  }

  return {
    ok: true,
    appId,
    deletedPaths,
    deletedDataRows,
  };
}
