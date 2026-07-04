import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assertSafePath } from '@/lib/office/path-guard';

function dataDir(): string {
  return (
    process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos')
  );
}

export function runOutputDir(runId: string): string {
  const dir = path.join(dataDir(), 'apps', 'amazon-rank', 'runs', runId);
  assertSafePath(dir);
  return dir;
}

export function ensureSnapshotDir(runId: string): string {
  const dir = path.join(runOutputDir(runId), 'snapshots');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function snapshotFilePath(runId: string, seq: number, keyword: string): string {
  const safe = keyword.replace(/[^a-z0-9]/gi, '_').slice(0, 50) || 'keyword';
  const file = path.join(ensureSnapshotDir(runId), `${String(seq).padStart(3, '0')}_${safe}.html`);
  assertSafePath(file);
  return file;
}

export function exportFilePath(runId: string): string {
  const dir = runOutputDir(runId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'rank_result.xlsx');
  assertSafePath(file);
  return file;
}

/** 供 API 读取快照/导出文件时做二次防护：必须落在本应用的输出目录内 */
export function assertInsideAppOutput(filePath: string): void {
  assertSafePath(filePath);
  const root = path.resolve(path.join(dataDir(), 'apps', 'amazon-rank'));
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('路径越界：只允许访问亚马逊排名助手自己的输出目录');
  }
}
