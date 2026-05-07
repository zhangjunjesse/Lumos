import fs from 'fs';
import os from 'os';
import path from 'path';

import JSZip from 'jszip';

import { parseApp } from '../manifest/parser';
import type { ConfigItem } from '../manifest/types';
import { validateApp } from '../manifest/validator';

import { derivePermissions } from './permissions';
import type {
  AppSource,
  InstallContext,
  InstallResult,
  InstallSource,
} from './types';

/**
 * Install a Lumos app from a zip file or directory.
 *
 * Flow (architecture doc §6.1):
 *   1. Unpack source to a fresh temp directory.
 *   2. Parse manifest + run cross-file validator.
 *   3. Check id/version conflict in the database.
 *   4. Derive permissions and request user consent.
 *   5. Atomically move the staged tree to {appsRootPath}/{id}/{version}/.
 *   6. If upgrading, rename the previous install dir to {version}.prev/
 *      and record previous_version + previous_install_path.
 *   7. Insert into lumos_app_apps inside a transaction.
 *   8. Insert granted permissions, default config values, and triggers.
 *   9. Return InstalledApp.
 *
 * On any failure after step 5 the staged tree is rolled back to its
 * original location and the database transaction is rolled back so the
 * user is not left with a half-installed app.
 */
export async function installApp(
  source: InstallSource,
  ctx: InstallContext,
  opts: { source: AppSource } = { source: 'local' },
): Promise<InstallResult> {
  const tmpRoot = ctx.tmpRootPath ?? os.tmpdir();
  const stagingDir = fs.mkdtempSync(path.join(tmpRoot, 'lumos-app-stage-'));
  const now = (ctx.now ?? Date.now)();
  const cleanupPaths: string[] = [stagingDir];

  try {
    // Step 1 — unpack
    try {
      if (source.type === 'zip') {
        await unpackZip(source.path, stagingDir);
      } else {
        copyDirectory(source.path, stagingDir);
      }
    } catch (err) {
      return {
        ok: false,
        error: 'UnpackError',
        issues: [],
        message: `Failed to unpack: ${(err as Error).message}`,
      };
    }

    // Step 2 — parse + validate
    const parsed = parseApp(stagingDir);
    if (!parsed.ok) {
      return {
        ok: false,
        error: 'ManifestInvalid',
        issues: parsed.issues,
        message: 'Manifest validation failed',
      };
    }
    const crossIssues = validateApp(parsed.app);
    const crossErrors = crossIssues.filter((i) => i.level === 'error');
    if (crossErrors.length > 0) {
      return {
        ok: false,
        error: 'CrossFileInvalid',
        issues: crossIssues,
        message: 'Cross-file consistency check failed',
      };
    }

    const manifest = parsed.app.manifest;

    // Step 3 — id / version conflict check
    const existing = ctx.db
      .prepare(
        `SELECT id, version, install_path FROM lumos_app_apps WHERE id = ?`,
      )
      .get(manifest.id) as
      | { id: string; version: string; install_path: string }
      | undefined;

    if (existing && existing.version === manifest.version) {
      return {
        ok: false,
        error: 'VersionConflict',
        issues: [],
        message: `App '${manifest.id}' v${manifest.version} is already installed; uninstall first to reinstall the same version.`,
      };
    }

    // Step 4 — consent
    const permissions = derivePermissions(manifest);
    let granted: string[] = [];
    if (ctx.onConsent) {
      const consent = await ctx.onConsent({
        manifest,
        permissions,
        isUpgrade: !!existing,
        previousVersion: existing?.version,
      });
      if (consent === null) {
        return {
          ok: false,
          error: 'UserCancelled',
          issues: [],
          message: 'User cancelled the install',
        };
      }
      const requested = new Set(permissions.map((p) => p.permission));
      granted = consent.granted.filter((g) => requested.has(g));
    } else {
      // No consent callback → grant nothing. Caller must opt in to granting.
      granted = [];
    }

    // Step 5 — atomic install path move
    const installRoot = path.join(ctx.appsRootPath, manifest.id);
    const installPath = path.join(installRoot, manifest.version);

    if (!fs.existsSync(ctx.appsRootPath)) {
      fs.mkdirSync(ctx.appsRootPath, { recursive: true });
    }
    if (!fs.existsSync(installRoot)) {
      fs.mkdirSync(installRoot, { recursive: true });
    }
    if (fs.existsSync(installPath)) {
      // Same id, same version path exists on disk but no DB row — likely a
      // half-cleaned previous attempt. Delete it before staging.
      fs.rmSync(installPath, { recursive: true, force: true });
    }

    try {
      moveCrossDevice(stagingDir, installPath);
    } catch (err) {
      return {
        ok: false,
        error: 'FilesystemError',
        issues: [],
        message: `Failed to move staged install: ${(err as Error).message}`,
      };
    }
    // Staging dir is now consumed.
    cleanupPaths.length = 0;

    // Step 6 — retain previous version
    let previousVersion: string | undefined;
    let previousInstallPath: string | undefined;
    if (existing) {
      previousVersion = existing.version;
      previousInstallPath = existing.install_path;
      // We DO NOT physically rename the previous dir; it stays at
      // .../{id}/{previousVersion}/ alongside the new {version}/. Cleanup
      // policy: keep one prior version; older are removed at install time.
      // (Anything beyond previousVersion is removed below.)
      const versionsDir = installRoot;
      for (const entry of fs.readdirSync(versionsDir)) {
        if (entry === manifest.version || entry === previousVersion) continue;
        try {
          fs.rmSync(path.join(versionsDir, entry), { recursive: true, force: true });
        } catch {
          // best-effort cleanup
        }
      }
    }

    // Steps 7-8 — DB writes inside a transaction
    try {
      ctx.db.exec('BEGIN');

      ctx.db
        .prepare(
          `INSERT INTO lumos_app_apps (
            id, name, version, previous_version, manifest_json, source,
            source_meta_json, install_path, previous_install_path,
            enabled, installed_at, last_used_at, size_bytes, synced_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, NULL)
          ON CONFLICT (id) DO UPDATE SET
            name = excluded.name,
            version = excluded.version,
            previous_version = excluded.previous_version,
            manifest_json = excluded.manifest_json,
            source = excluded.source,
            source_meta_json = excluded.source_meta_json,
            install_path = excluded.install_path,
            previous_install_path = excluded.previous_install_path,
            enabled = 1,
            installed_at = excluded.installed_at,
            size_bytes = excluded.size_bytes`,
        )
        .run(
          manifest.id,
          manifest.name,
          manifest.version,
          previousVersion ?? null,
          JSON.stringify(manifest),
          opts.source,
          null,
          installPath,
          previousInstallPath ?? null,
          now,
          dirSize(installPath),
        );

      // Re-key permissions: cascade-delete on app row replace handles old
      // rows automatically. With ON CONFLICT DO UPDATE we did not delete
      // dependents; do so explicitly.
      ctx.db.prepare(`DELETE FROM lumos_app_permissions WHERE app_id = ?`).run(manifest.id);
      const insertPerm = ctx.db.prepare(
        `INSERT INTO lumos_app_permissions (app_id, permission, granted, granted_at)
         VALUES (?, ?, ?, ?)`,
      );
      for (const p of permissions) {
        const isGranted = granted.includes(p.permission) ? 1 : 0;
        insertPerm.run(manifest.id, p.permission, isGranted, now);
      }

      // Triggers: replace
      ctx.db.prepare(`DELETE FROM lumos_app_triggers WHERE app_id = ?`).run(manifest.id);
      ctx.triggers.register(manifest.id, manifest.triggers);

      // Default config values: only insert keys that don't already exist
      // (so a re-install of the same id keeps user-provided values).
      const existingKeys = new Set(
        ctx.vault.list(manifest.id).map((m) => m.key),
      );
      for (const c of manifest.config ?? []) {
        if (existingKeys.has(c.key)) continue;
        const def = defaultConfigValue(c);
        if (def !== undefined) {
          ctx.vault.set(manifest.id, c.key, def, { secret: !!c.secret });
        }
      }

      ctx.db.exec('COMMIT');
    } catch (err) {
      try {
        ctx.db.exec('ROLLBACK');
      } catch {
        // already rolled back
      }
      // Try to remove the freshly-installed dir (best-effort).
      try {
        fs.rmSync(installPath, { recursive: true, force: true });
      } catch {
        // ignore
      }
      return {
        ok: false,
        error: 'FilesystemError',
        issues: [],
        message: `Database write failed: ${(err as Error).message}`,
      };
    }

    return {
      ok: true,
      installed: {
        appId: manifest.id,
        version: manifest.version,
        installPath,
        source: opts.source,
        isUpgrade: !!existing,
        previousVersion,
      },
      warnings: crossIssues.filter((i) => i.level === 'warning'),
    };
  } finally {
    for (const p of cleanupPaths) {
      try {
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

// ---------- helpers ----------

async function unpackZip(zipPath: string, destDir: string): Promise<void> {
  const data = await fs.promises.readFile(zipPath);
  const zip = await JSZip.loadAsync(data);

  for (const [filePath, entry] of Object.entries(zip.files)) {
    const safe = sanitizeZipPath(filePath);
    const full = path.join(destDir, safe);
    if (entry.dir) {
      fs.mkdirSync(full, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const content = await entry.async('nodebuffer');
    fs.writeFileSync(full, content);
  }
}

/**
 * Sanitize a zip entry path against the "zip slip" family of attacks.
 *
 * Rejects:
 *   - Windows drive letters (C:, D:, ...).
 *   - Any backslash separators (a forward-slash app universe doesn't need
 *     them, and they evade POSIX path.normalize on Linux/macOS).
 *   - Absolute paths (leading '/').
 *   - Parent traversal segments ('..') even after normalization.
 *
 * Exported for unit tests.
 */
export function sanitizeZipPath(p: string): string {
  if (typeof p !== 'string' || p === '') {
    throw new Error('Unsafe path in zip (empty)');
  }
  if (/^[A-Za-z]:/.test(p)) {
    throw new Error(`Unsafe path in zip (drive letter): ${p}`);
  }
  if (p.includes('\\')) {
    throw new Error(`Unsafe path in zip (backslash separator): ${p}`);
  }
  const normalized = path.posix.normalize(p);
  if (normalized.startsWith('/')) {
    throw new Error(`Unsafe path in zip (absolute): ${p}`);
  }
  if (normalized.split('/').includes('..')) {
    throw new Error(`Unsafe path in zip (parent traversal): ${p}`);
  }
  return normalized;
}

function copyDirectory(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(src, dest);
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dest);
    }
    // ignore symlinks/devices for safety
  }
}

function moveCrossDevice(src: string, dest: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EXDEV' || code === 'ENOTEMPTY' || code === 'EPERM') {
      copyDirectory(src, dest);
      fs.rmSync(src, { recursive: true, force: true });
      return;
    }
    throw err;
  }
}

function dirSize(dirPath: string): number {
  let total = 0;
  const stack = [dirPath];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) total += fs.statSync(full).size;
    }
  }
  return total;
}

function defaultConfigValue(c: ConfigItem): string | undefined {
  if (c.default === undefined || c.default === null) return undefined;
  if (typeof c.default === 'string') return c.default;
  if (typeof c.default === 'number' || typeof c.default === 'boolean') {
    return String(c.default);
  }
  return JSON.stringify(c.default);
}
