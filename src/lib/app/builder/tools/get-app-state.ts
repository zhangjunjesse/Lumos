import fs from 'fs';
import path from 'path';

import type Database from 'better-sqlite3';

import type { AppManifest } from '../../manifest/types';

import { type ToolDefinition, err, ok } from './types';

/**
 * Tool: get_app_state({ appId })
 *
 * Returns the current installed state of an app — manifest + listing of
 * files under the install dir. Used during incremental iteration (B4):
 * the agent reads existing files before proposing a diff via
 * update_app_file. Avoids carrying full file contents in the conversation
 * history when only a small subset will be touched.
 */

export interface GetAppStateInput {
  appId: string;
}

export interface AppStateFile {
  path: string;
  size: number;
  /** True if the file content was readable as UTF-8 text and ≤ maxBytes. */
  readable: boolean;
  /** Present when readable. */
  content?: string;
}

export interface GetAppStateOutput {
  appId: string;
  installed: boolean;
  manifest?: AppManifest;
  installPath?: string;
  files: AppStateFile[];
}

const MAX_INLINE_BYTES = 64 * 1024;
const READABLE_EXTS = new Set(['.json', '.md', '.txt', '.tsx']);

export function createGetAppStateTool(
  db: Database.Database,
): ToolDefinition<GetAppStateInput, GetAppStateOutput> {
  return {
    name: 'get_app_state',
    description:
      'Read the current state of an installed app: its manifest plus a listing of files (with inline content for small text files). Use this before updating individual files so your edits target the actual on-disk state.',
    inputSchema: {
      type: 'object',
      required: ['appId'],
      additionalProperties: false,
      properties: {
        appId: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,63}$' },
      },
    },
    async execute(input) {
      const row = db
        .prepare(
          `SELECT install_path, manifest_json FROM lumos_app_apps WHERE id = ?`,
        )
        .get(input.appId) as
        | { install_path: string; manifest_json: string }
        | undefined;
      if (!row) {
        return ok({
          appId: input.appId,
          installed: false,
          files: [],
        });
      }

      let manifest: AppManifest;
      try {
        manifest = JSON.parse(row.manifest_json) as AppManifest;
      } catch (e) {
        return err('CorruptManifest', `manifest_json is not valid JSON: ${(e as Error).message}`);
      }

      const files: AppStateFile[] = [];
      try {
        walkDir(row.install_path, row.install_path, files);
      } catch (e) {
        return err('IOError', `Failed to walk install dir: ${(e as Error).message}`);
      }

      return ok({
        appId: input.appId,
        installed: true,
        manifest,
        installPath: row.install_path,
        files,
      });
    },
  };
}

function walkDir(root: string, current: string, out: AppStateFile[]): void {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      walkDir(root, full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = fs.statSync(full);
    const rel = path.relative(root, full).split(path.sep).join('/');
    const ext = path.extname(rel).toLowerCase();
    const readable = READABLE_EXTS.has(ext) && stat.size <= MAX_INLINE_BYTES;
    out.push({
      path: rel,
      size: stat.size,
      readable,
      content: readable ? fs.readFileSync(full, 'utf-8') : undefined,
    });
  }
}
