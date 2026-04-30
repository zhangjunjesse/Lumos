import fs from 'fs';
import os from 'os';
import path from 'path';

import { installApp } from '../../installer';
import type {
  ConsentCallback,
  InstallContext,
  InstalledApp,
} from '../../installer';

import { type ToolDefinition, err, ok } from './types';

/**
 * Tool: install_app({ files | rootPath })
 *
 * Take the agent's freshly-generated package, materialize it (if given as
 * files map), and run the standard installer with source: 'ai-generated'.
 *
 * **Consent**: this tool MUST go through the same ConsentCallback the
 * regular install flow uses — even when the AppBuilder is the one
 * proposing the install. The user, not the agent, decides whether to
 * grant the permissions the manifest requested. The agent should call
 * this tool only AFTER it has explained the permission set in chat;
 * the UI shell binds onConsent to InstallDialog.
 *
 * In-memory mode materializes files to a temp directory, then invokes
 * installer with source: 'directory'. The temp dir is cleaned up after
 * the installer's own atomic move.
 */

export interface InstallAppInput {
  files?: Record<string, string>;
  rootPath?: string;
}

export interface InstallAppOutput {
  installed: InstalledApp;
}

export interface InstallAppToolDeps {
  installContext: () => InstallContext;
  /**
   * Optional consent override for tests. Production wires the renderer
   * dialog through the install-context's onConsent.
   */
  consentOverride?: ConsentCallback;
}

export function createInstallAppTool(
  deps: InstallAppToolDeps,
): ToolDefinition<InstallAppInput, InstallAppOutput> {
  return {
    name: 'install_app',
    description:
      'Install the freshly generated app package. Pass either { files: { path: content } } (in-memory) or { rootPath } (an existing dir on disk). The installer will surface a ConsentRequest to the user via the UI; do not call this tool until you have explained the permission set in chat.',
    inputSchema: {
      type: 'object',
      oneOf: [
        { required: ['files'] },
        { required: ['rootPath'] },
      ],
      properties: {
        files: {
          type: 'object',
          additionalProperties: { type: 'string' },
        },
        rootPath: { type: 'string' },
      },
    },
    async execute(input) {
      let cleanupDir: string | undefined;
      try {
        let rootPath: string;
        if (input.rootPath) {
          rootPath = input.rootPath;
          if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
            return err('NotFound', `rootPath does not point to a directory: ${rootPath}`);
          }
        } else if (input.files) {
          cleanupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-install-tool-'));
          materializeFiles(input.files, cleanupDir);
          rootPath = cleanupDir;
        } else {
          return err('BadInput', 'install_app requires either files or rootPath');
        }

        const ctx = deps.installContext();
        if (deps.consentOverride) {
          ctx.onConsent = deps.consentOverride;
        }

        const result = await installApp(
          { type: 'directory', path: rootPath },
          ctx,
          { source: 'ai-generated' },
        );

        if (!result.ok) {
          return err(result.error, result.message, { issues: result.issues });
        }
        return ok({ installed: result.installed }, result.warnings);
      } finally {
        if (cleanupDir) {
          try {
            fs.rmSync(cleanupDir, { recursive: true, force: true });
          } catch {
            // ignore
          }
        }
      }
    },
  };
}

function materializeFiles(files: Record<string, string>, rootPath: string): void {
  for (const [rel, content] of Object.entries(files)) {
    if (!isSafeRelativePath(rel)) {
      throw new Error(`Unsafe path in files: ${rel}`);
    }
    const full = path.join(rootPath, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  // Same icon-fallback behavior as validate_app: the agent may produce a
  // proper icon as one of the files; otherwise drop a placeholder so the
  // installer's icon-existence check passes. Production swaps this for a
  // real default icon at integration time.
  const iconPath = path.join(rootPath, 'icon.png');
  if (!fs.existsSync(iconPath)) {
    fs.writeFileSync(iconPath, 'PNG_PLACEHOLDER');
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
