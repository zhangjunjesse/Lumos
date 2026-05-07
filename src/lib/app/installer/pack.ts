import fs from 'fs';
import path from 'path';

import JSZip from 'jszip';

import { parseApp } from '../manifest/parser';
import type { ValidationIssue } from '../manifest/types';
import { validateApp } from '../manifest/validator';

/**
 * Pack a directory into a `.lumos-app` zip suitable for distribution.
 *
 * Validates the source first; returns errors instead of writing junk to disk.
 */

export type PackResult =
  | { ok: true; outputPath: string; sizeBytes: number; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[]; message: string };

export async function packApp(
  sourceDir: string,
  outputPath: string,
): Promise<PackResult> {
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    return {
      ok: false,
      issues: [],
      message: `Source is not a directory: ${sourceDir}`,
    };
  }

  const parsed = parseApp(sourceDir);
  if (!parsed.ok) {
    return {
      ok: false,
      issues: parsed.issues,
      message: 'Manifest validation failed; refusing to pack',
    };
  }
  const cross = validateApp(parsed.app);
  if (cross.some((i) => i.level === 'error')) {
    return {
      ok: false,
      issues: cross,
      message: 'Cross-file consistency check failed; refusing to pack',
    };
  }

  const zip = new JSZip();
  await addDirectoryToZip(zip, sourceDir, '');

  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, buf);

  return {
    ok: true,
    outputPath,
    sizeBytes: buf.length,
    warnings: cross.filter((i) => i.level === 'warning'),
  };
}

async function addDirectoryToZip(
  zip: JSZip,
  dir: string,
  zipPrefix: string,
): Promise<void> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Skip OS clutter and version control dirs.
    if (entry.name === '.DS_Store' || entry.name === '.git' || entry.name === 'node_modules') {
      continue;
    }
    const full = path.join(dir, entry.name);
    const zipPath = zipPrefix ? `${zipPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, full, zipPath);
    } else if (entry.isFile()) {
      zip.file(zipPath, fs.readFileSync(full));
    }
  }
}
