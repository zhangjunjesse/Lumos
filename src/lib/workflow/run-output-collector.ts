/**
 * Walks a workflow run's workspace and returns every file produced under each
 * stage's `output/` directory. Filenames preserve their subpath so files from
 * different subdirectories stay distinguishable. Used by the run detail API.
 */
import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';

export interface RunOutputFile {
  name: string;
  stepId: string;
  agentName: string;
  content: string;
  sizeBytes: number;
  filePath: string;
  mimeType?: string;
  createdAt?: string;
}

const BINARY_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  mdx: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  xml: 'text/xml',
  html: 'text/html',
  htm: 'text/html',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};

function getFileMimeType(fileName: string): string | undefined {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_MIME[ext];
}

function isTextLikeMimeType(mimeType: string | undefined): boolean {
  if (!mimeType) return true;
  return mimeType.startsWith('text/') || mimeType === 'application/json';
}

async function dirExists(targetPath: string): Promise<boolean> {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

export async function collectRunOutputFiles(
  runWorkspaceRoot: string,
  agentNameMap: Map<string, string>,
): Promise<RunOutputFile[]> {
  const stagesDir = path.join(runWorkspaceRoot, 'stages');
  if (!await dirExists(stagesDir)) return [];

  const results: RunOutputFile[] = [];
  const stageIds = await readdir(stagesDir).catch(() => [] as string[]);

  for (const stageId of stageIds) {
    const outputDir = path.join(stagesDir, stageId, 'output');
    if (!await dirExists(outputDir)) continue;
    await walkOutputDir(outputDir, '', stageId, agentNameMap, results);
  }

  results.sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? ''));
  return results;
}

async function walkOutputDir(
  rootDir: string,
  relativePrefix: string,
  stageId: string,
  agentNameMap: Map<string, string>,
  results: RunOutputFile[],
): Promise<void> {
  const currentDir = path.join(rootDir, relativePrefix);
  const entries = await readdir(currentDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const rel = relativePrefix ? path.join(relativePrefix, entry.name) : entry.name;
    const abs = path.join(rootDir, rel);
    if (entry.isDirectory()) {
      await walkOutputDir(rootDir, rel, stageId, agentNameMap, results);
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const mimeType = getFileMimeType(entry.name);
      const fileStat = await stat(abs);
      let content = '';
      if (mimeType?.startsWith('image/')) {
        content = (await readFile(abs)).toString('base64');
      } else if (isTextLikeMimeType(mimeType)) {
        content = await readFile(abs, 'utf-8');
      }
      results.push({
        name: rel.split(path.sep).join('/'),
        stepId: stageId,
        agentName: agentNameMap.get(stageId) || stageId,
        filePath: abs,
        content,
        sizeBytes: fileStat.size,
        createdAt: fileStat.mtime.toISOString(),
        ...(mimeType ? { mimeType } : {}),
      });
    } catch {
      // Ignore unreadable files and keep returning the rest of the report.
    }
  }
}
