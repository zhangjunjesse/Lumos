import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { isPathSafe, isRootPath } from '@/lib/files';
import { buildReferenceContent } from '@/lib/knowledge/parsers';
import { processImport } from '@/lib/knowledge/importer';
import * as store from '@/lib/knowledge/store';
import { buildSourceKey } from '@/lib/knowledge/source-key';
import { ensureDefaultCollectionId } from '@/lib/knowledge/default-collection';
import { createIngestJob } from '@/lib/knowledge/ingest-queue';
import { ensureKnowledgeIngestWorker, triggerKnowledgeIngestNow } from '@/lib/knowledge/ingest-worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_MAX_FILES = 2000;
const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const KNOWN_IMPORT_EXTS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.text',
  '.log',
  '.ini',
  '.cfg',
  '.conf',
  '.toml',
  '.tsv',
  '.properties',
  '.sql',
  '.ipynb',
  '.json',
  '.jsonl',
  '.html',
  '.htm',
  '.xml',
  '.yaml',
  '.yml',
  '.rtf',
  '.odt',
  '.ods',
  '.odp',
  '.epub',
  '.pages',
  '.numbers',
  '.key',
  '.wps',
  '.et',
  '.dps',
  '.ofd',
  '.mpp',
  '.vsd',
  '.vsdx',
  '.msg',
  '.eml',
  '.pdf',
  '.doc',
  '.docx',
  '.docm',
  '.ppt',
  '.pptx',
  '.pptm',
  '.xls',
  '.xlsx',
  '.xlsm',
  '.csv',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.svg',
  '.heic',
  '.heif',
  '.avif',
  '.mp3',
  '.wav',
  '.aac',
  '.flac',
  '.m4a',
  '.ogg',
  '.opus',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.webm',
  '.m4v',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.rb',
  '.php',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.hh',
  '.cs',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.bat',
  '.cmd',
  '.lua',
  '.r',
  '.scala',
  '.vue',
  '.svelte',
  '.astro',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.proto',
  '.gradle',
  '.dockerfile',
  '.env',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
]);

const BLOCKED_EXTS = new Set([
  '.exe',
  '.dll',
  '.dylib',
  '.so',
  '.bin',
  '.o',
  '.a',
  '.class',
  '.apk',
  '.ipa',
  '.msi',
  '.deb',
  '.rpm',
  '.pkg',
  '.iso',
  '.dmg',
  '.img',
  '.qcow2',
  '.vmdk',
  '.pyc',
  '.pyo',
  '.node',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
  '.icns',
  '.sqlite',
  '.db',
  '.db-wal',
  '.db-shm',
  '.wal',
  '.shm',
]);

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.turbo',
  '.output',
]);

interface ImportDirectoryBody {
  directory?: string;
  collection_id?: string;
  recursive?: boolean;
  maxFiles?: number;
  maxFileSize?: number;
  baseDir?: string;
  mode?: 'reference' | 'ingest';
  title?: string;
  tags?: string[];
  force_reprocess?: boolean;
}

function shouldQueueFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (BLOCKED_EXTS.has(ext)) return false;
  if (!ext) return true;
  if (KNOWN_IMPORT_EXTS.has(ext)) return true;
  // Accept short, text-like extensions by default; parser will downgrade to reference if unsupported.
  if (/^\.[a-z0-9]{1,7}$/.test(ext)) return true;
  return false;
}

async function collectFiles(dir: string, recursive: boolean): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      if (recursive) {
        files.push(...await collectFiles(fullPath, recursive));
      }
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ImportDirectoryBody;
    const directory = body.directory?.trim();
    if (!directory) {
      return NextResponse.json({ error: 'directory required' }, { status: 400 });
    }

    const resolvedDir = path.resolve(directory);
    const baseDir = body.baseDir?.trim();
    if (baseDir) {
      const resolvedBase = path.resolve(baseDir);
      if (isRootPath(resolvedBase)) {
        return NextResponse.json({ error: 'Cannot use filesystem root as base directory' }, { status: 403 });
      }
      if (!isPathSafe(resolvedBase, resolvedDir)) {
        return NextResponse.json({ error: 'Directory is outside the allowed scope' }, { status: 403 });
      }
    } else {
      const homeDir = os.homedir();
      if (!isPathSafe(homeDir, resolvedDir)) {
        return NextResponse.json({ error: 'Directory is outside the allowed scope' }, { status: 403 });
      }
    }

    const stat = await fs.stat(resolvedDir);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: 'Path is not a directory' }, { status: 400 });
    }

    const collectionId = body.collection_id || ensureDefaultCollectionId();
    const mode = body.mode || 'reference';

    if (mode !== 'ingest') {
      const sourceKey = buildSourceKey({ sourceType: 'local_dir', sourcePath: resolvedDir });
      let existing = store.findItemBySourceKey(collectionId, sourceKey);
      if (!existing) {
        existing = store.findItemBySource(collectionId, 'local_dir', resolvedDir);
      }
      if (existing) {
        return NextResponse.json({ duplicate: true, item: existing, message: '目录已存在，已跳过添加', mode: 'reference' });
      }
      const title = body.title?.trim() || path.basename(resolvedDir);
      const result = await processImport(collectionId, {
        title,
        source_type: 'local_dir',
        source_path: resolvedDir,
        source_key: sourceKey,
        tags: body.tags,
      }, buildReferenceContent(resolvedDir, 'directory_reference'), {
        mode: 'reference',
        parseError: 'directory_reference',
      });
      return NextResponse.json({ mode: 'reference', ...result });
    }

    const recursive = body.recursive !== false;
    const maxFiles = Math.min(Math.max(1, body.maxFiles ?? DEFAULT_MAX_FILES), 20000);
    const maxFileSize = body.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;

    const allFiles = await collectFiles(resolvedDir, recursive);
    const candidates = allFiles.filter((filePath) => shouldQueueFile(filePath));
    const limited = candidates.slice(0, maxFiles);
    const skippedByType = Math.max(0, allFiles.length - candidates.length);
    const forceReprocess = body.force_reprocess === true;

    const queuedFiles: Array<{ filePath: string; sourceKey: string; fileSize: number }> = [];
    let unreadable = 0;
    for (const filePath of limited) {
      try {
        const fileStat = await fs.stat(filePath);
        if (!fileStat.isFile()) {
          unreadable += 1;
          continue;
        }
        queuedFiles.push({
          filePath,
          sourceKey: buildSourceKey({ sourceType: 'local_file', sourcePath: filePath }),
          fileSize: fileStat.size,
        });
      } catch {
        unreadable += 1;
      }
    }

    if (queuedFiles.length === 0) {
      return NextResponse.json({ error: 'No valid files found for import' }, { status: 400 });
    }

    const job = createIngestJob({
      collectionId,
      sourceDir: resolvedDir,
      recursive,
      maxFiles,
      maxFileSize,
      forceReprocess,
      files: queuedFiles,
    });

    ensureKnowledgeIngestWorker();
    triggerKnowledgeIngestNow();

    return NextResponse.json({
      mode: 'ingest',
      queued: true,
      job,
      total: queuedFiles.length,
      skipped: (candidates.length - limited.length) + unreadable + skippedByType,
      message: forceReprocess
        ? '目录已加入后台重处理队列'
        : '目录已加入后台入库队列',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to import directory';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
