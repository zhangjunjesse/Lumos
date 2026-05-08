import fs from 'fs';
import os from 'os';
import path from 'path';

import { parseApp } from '../../manifest/parser';
import type { ValidationIssue } from '../../manifest/types';
import { validateApp as crossValidate } from '../../manifest/validator';
import { validateNativeAppPackageDirectory } from '../../native-app-package-validation';

import { type ToolDefinition, err, ok } from './types';

/**
 * Tool: validate_app(files | rootPath)
 *
 * Run the full parser + cross-file validator over an in-memory file map
 * (the typical agent flow) or an existing directory (when iterating on
 * an installed app). Returns issues[] grouped by file with jsonPath; the
 * agent is expected to feed these back into the appropriate generate_*
 * tool to repair.
 *
 * In-memory mode materializes the files into a temp dir, runs validation,
 * then cleans up. This trades a small amount of IO for code reuse with the
 * existing parser, which already handles file-tree quirks (subdirs, etc.).
 */

export type ValidateAppInput =
  | { files: Record<string, string> /* path → content (UTF-8) */; nativeGrade?: boolean }
  | { rootPath: string; nativeGrade?: boolean };

export interface ValidateAppOutput {
  ok: boolean;
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
}

export const validateAppTool: ToolDefinition<ValidateAppInput, ValidateAppOutput> = {
  name: 'validate_app',
  description:
    'Run the parser + cross-file validator on a complete app package. For Lumos native-grade generated apps, pass nativeGrade:true to also enforce native-app-spec.json, common shell pages, run history, IM command, automation, and acceptance contracts.',
  inputSchema: {
    type: 'object',
    oneOf: [
      {
        required: ['files'],
        properties: {
          files: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Map of relative path → UTF-8 content. Must include app.json and routes.json.',
          },
          nativeGrade: {
            type: 'boolean',
            description: 'When true, enforce Lumos native-grade app package requirements.',
          },
        },
      },
      {
        required: ['rootPath'],
        properties: {
          rootPath: { type: 'string' },
          nativeGrade: {
            type: 'boolean',
            description: 'When true, enforce Lumos native-grade app package requirements.',
          },
        },
      },
    ],
  },
  async execute(input) {
    let cleanupDir: string | undefined;
    try {
      let rootPath: string;
      if ('rootPath' in input) {
        rootPath = input.rootPath;
        if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
          return err('NotFound', `rootPath does not point to a directory: ${rootPath}`);
        }
      } else {
        if (!input.files || typeof input.files !== 'object') {
          return err('BadInput', 'files must be a { path: content } object');
        }
        cleanupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-validate-app-'));
        try {
          materializeFiles(input.files, cleanupDir);
        } catch (e) {
          return err('BadInput', (e as Error).message);
        }
        rootPath = cleanupDir;
      }

      const parsed = parseApp(rootPath);
      const issues: ValidationIssue[] = [];
      if (!parsed.ok) {
        issues.push(...parsed.issues);
      } else {
        issues.push(...parsed.issues);
        issues.push(...crossValidate(parsed.app));
      }
      if (input.nativeGrade === true) {
        issues.push(...validateNativeAppPackageDirectory(rootPath).issues);
      }
      const errors = issues.filter((i) => i.level === 'error');
      const warnings = issues.filter((i) => i.level === 'warning');
      return ok(
        {
          ok: errors.length === 0,
          issues,
          errorCount: errors.length,
          warningCount: warnings.length,
        },
        warnings,
      );
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

function materializeFiles(files: Record<string, string>, rootPath: string): void {
  for (const [rel, content] of Object.entries(files)) {
    if (!isSafeRelativePath(rel)) {
      throw new Error(`Unsafe path in files: ${rel}`);
    }
    const full = path.join(rootPath, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  // Ensure icon.png exists so the cross-validator's existence check passes.
  // The agent may have produced an icon as part of `files`; otherwise
  // drop a placeholder so VALIDATION (not installation) succeeds.
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
