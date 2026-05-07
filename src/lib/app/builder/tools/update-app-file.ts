import fs from 'fs';
import path from 'path';

import type Database from 'better-sqlite3';

import { resolveAssetPath } from '../../installer/asset-resolver';
import { parseApp } from '../../manifest/parser';
import type { ValidationIssue } from '../../manifest/types';
import { validateApp } from '../../manifest/validator';

import { type ToolDefinition, err, ok } from './types';

/**
 * Tool: update_app_file({ appId, path, content, dryRun? })
 *
 * Patch a single file inside an installed app's directory. Validates the
 * post-patch package before persisting and rolls back on any error.
 * The exact path safety check from the assets route is reused, so updates
 * cannot escape the install root and cannot touch reserved subtrees
 * (components/, .history/, etc.).
 *
 * Validation policy:
 *   - The full app is re-parsed and cross-validated after the patch.
 *   - Errors → rollback, return SchemaInvalid with issues[].
 *   - Warnings → keep the patch, return ok with warnings.
 *
 * `dryRun: true` runs the validation without writing to disk; useful for
 * the agent to confirm a change is safe before committing.
 */

export interface UpdateAppFileInput {
  appId: string;
  path: string;
  content: string;
  dryRun?: boolean;
}

export interface UpdateAppFileOutput {
  appId: string;
  path: string;
  written: boolean;
  warnings: ValidationIssue[];
}

export function createUpdateAppFileTool(
  db: Database.Database,
): ToolDefinition<UpdateAppFileInput, UpdateAppFileOutput> {
  return {
    name: 'update_app_file',
    description:
      'Replace the content of a single file inside an installed app. The full app is re-validated after the patch; errors trigger a rollback. Use dryRun: true to validate without writing.',
    inputSchema: {
      type: 'object',
      required: ['appId', 'path', 'content'],
      additionalProperties: false,
      properties: {
        appId: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,63}$' },
        path: {
          type: 'string',
          description:
            'Relative path inside the install dir. e.g. "pages/customers.json". Must pass the same allowlist used by the assets route.',
        },
        content: { type: 'string' },
        dryRun: { type: 'boolean', default: false },
      },
    },
    async execute(input) {
      const row = db
        .prepare(`SELECT install_path FROM lumos_app_apps WHERE id = ?`)
        .get(input.appId) as { install_path: string } | undefined;
      if (!row) {
        return err('NotInstalled', `App '${input.appId}' is not installed`);
      }

      const segments = input.path.split('/').filter((s) => s.length > 0);
      // Allow the resolver to accept paths to files that don't yet exist by
      // first checking the parent dir; resolveAssetPath asserts the target
      // exists, which we don't want for create-on-update. Instead we run a
      // lightweight version of the same checks here.
      if (segments.length === 0) {
        return err('BadInput', 'path must be non-empty');
      }
      if (!isSafeRelativePath(input.path)) {
        return err('BadPath', `Unsafe path: ${input.path}`);
      }
      // resolveAssetPath enforces existence — we use it post-write or
      // we accept new files. Here we just enforce the path policy by
      // re-using its segment + top-level checks for reads of an existing
      // sibling.
      const targetAbs = path.join(row.install_path, ...segments);
      const installRoot = path.resolve(row.install_path);
      if (!path.resolve(targetAbs).startsWith(installRoot + path.sep)) {
        return err('OutsideRoot', `Path resolves outside the install root: ${input.path}`);
      }

      // Top-level allowlist check — reuse the resolver's logic for the
      // existence-required case so we get the same rejection messages.
      const probe = resolveAssetPath(row.install_path, segments);
      if (
        !probe.ok &&
        probe.reason !== 'NotFound' && // creating new files is OK
        probe.reason !== 'TooLarge' // size cap doesn't apply to writes
      ) {
        return err(probe.reason, `Path policy rejected: ${input.path}`);
      }

      // Stage: read current contents (for rollback) and write new.
      const previousContent = fs.existsSync(targetAbs)
        ? fs.readFileSync(targetAbs)
        : null;
      const dryRun = !!input.dryRun;

      try {
        if (!dryRun) {
          fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
          fs.writeFileSync(targetAbs, input.content);
        }

        // For dryRun, write into a temp clone first so we can validate;
        // real installer rollback semantics also apply here.
        let validateRoot: string;
        let cleanup: (() => void) | undefined;
        if (dryRun) {
          const cloneRoot = fs.mkdtempSync(path.join(path.dirname(row.install_path), '.lumos-dryrun-'));
          cloneDir(row.install_path, cloneRoot);
          fs.mkdirSync(path.dirname(path.join(cloneRoot, ...segments)), { recursive: true });
          fs.writeFileSync(path.join(cloneRoot, ...segments), input.content);
          validateRoot = cloneRoot;
          cleanup = () => fs.rmSync(cloneRoot, { recursive: true, force: true });
        } else {
          validateRoot = row.install_path;
        }

        try {
          const parsed = parseApp(validateRoot);
          if (!parsed.ok) {
            if (!dryRun) rollback(targetAbs, previousContent);
            return err('SchemaInvalid', 'Patch produced an invalid app', {
              issues: parsed.issues,
            });
          }
          const cross = validateApp(parsed.app);
          const errors = cross.filter((i) => i.level === 'error');
          if (errors.length > 0) {
            if (!dryRun) rollback(targetAbs, previousContent);
            return err('CrossFileInvalid', 'Patch broke cross-file consistency', {
              issues: cross,
            });
          }
          return ok(
            {
              appId: input.appId,
              path: input.path,
              written: !dryRun,
              warnings: cross.filter((i) => i.level === 'warning'),
            },
            cross.filter((i) => i.level === 'warning'),
          );
        } finally {
          cleanup?.();
        }
      } catch (e) {
        if (!dryRun) rollback(targetAbs, previousContent);
        return err('IOError', (e as Error).message);
      }
    },
  };
}

function rollback(targetAbs: string, previous: Buffer | null): void {
  try {
    if (previous === null) {
      if (fs.existsSync(targetAbs)) fs.unlinkSync(targetAbs);
    } else {
      fs.writeFileSync(targetAbs, previous);
    }
  } catch {
    // best effort
  }
}

function cloneDir(src: string, dest: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      cloneDir(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function isSafeRelativePath(p: string): boolean {
  if (typeof p !== 'string' || p === '') return false;
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false;
  if (p.includes('\\')) return false;
  const normalized = path.posix.normalize(p);
  if (normalized.startsWith('/')) return false;
  if (normalized.split('/').includes('..')) return false;
  return true;
}
