import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadToken } from '@/lib/feishu-auth';
import { getSession } from '@/lib/db/sessions';
import { ensureDefaultCollectionId } from '@/lib/knowledge/default-collection';
import { createIngestJob } from '@/lib/knowledge/ingest-queue';
import { ensureKnowledgeIngestWorker, triggerKnowledgeIngestNow } from '@/lib/knowledge/ingest-worker';
import {
  buildFeishuReferenceMarkdown,
  exportFeishuDocumentMarkdown,
  feishuFetch,
  type FeishuDocReference,
} from '@/lib/feishu/doc-content';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FEISHU_BASE_URL = 'https://open.feishu.cn/open-apis';
const DOC_TYPES = new Set(['doc', 'docx', 'sheet', 'bitable', 'wiki']);
const MAX_ALLOWED_FILES = 5000;
const DEFAULT_MAX_FILES = 2000;
const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024;

interface ImportFolderBody {
  token?: string;
  title?: string;
  sessionId?: string;
  collectionId?: string;
  maxFiles?: number;
  maxFileSize?: number;
  forceReprocess?: boolean;
}

interface FeishuDriveItem {
  token?: string;
  node_token?: string;
  obj_token?: string;
  name?: string;
  title?: string;
  type?: string;
  obj_type?: string;
  url?: string;
  file_extension?: string;
  mime_type?: string;
}

interface QueueFile {
  filePath: string;
  sourceKey: string;
  fileSize: number;
}

interface MirrorStats {
  folders: number;
  docs: number;
  files: number;
  skipped: number;
  truncated: boolean;
}

function safeName(input: string): string {
  return input.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'feishu-item';
}

function stripExt(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

function extFromName(name?: string): string {
  if (!name) return '';
  const idx = name.lastIndexOf('.');
  if (idx < 0) return '';
  const ext = name.slice(idx);
  return ext.length <= 10 ? ext : '';
}

function normalizeExt(ext?: string): string {
  if (!ext) return '';
  const value = ext.startsWith('.') ? ext : `.${ext}`;
  return value.length <= 12 ? value.toLowerCase() : '';
}

function buildDocUrl(type: string, token: string, currentUrl?: string): string {
  if (currentUrl) return currentUrl;
  if (!token) return '';
  if (type === 'doc') return `https://feishu.cn/doc/${token}`;
  if (type === 'docx') return `https://feishu.cn/docx/${token}`;
  if (type === 'sheet') return `https://feishu.cn/sheets/${token}`;
  if (type === 'bitable') return `https://feishu.cn/base/${token}`;
  if (type === 'wiki') return `https://feishu.cn/wiki/${token}`;
  return `https://feishu.cn/drive/folder/${token}`;
}

async function ensureUniquePath(dir: string, preferredName: string): Promise<string> {
  const ext = path.extname(preferredName);
  const base = ext ? preferredName.slice(0, -ext.length) : preferredName;
  let candidate = path.join(dir, preferredName);
  let idx = 1;
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(dir, `${base}-${idx}${ext}`);
      idx += 1;
    } catch {
      return candidate;
    }
  }
}

async function fetchDownload(accessToken: string, token: string): Promise<Buffer> {
  let res = await fetch(`${FEISHU_BASE_URL}/drive/v1/files/${token}/download`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 301 || res.status === 302) {
    const location = res.headers.get('location');
    if (location) {
      res = await fetch(location);
    }
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => ({}));
    const downloadUrl = data?.data?.download_url || data?.data?.url;
    if (downloadUrl) {
      res = await fetch(downloadUrl);
    } else if (!res.ok) {
      throw new Error(data?.msg || data?.message || `飞书下载失败 (${res.status})`);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `飞书下载失败 (${res.status})`);
  }

  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}

async function listFolderItems(accessToken: string, folderToken: string): Promise<FeishuDriveItem[]> {
  const all: FeishuDriveItem[] = [];
  let pageToken = '';

  while (true) {
    const query = new URLSearchParams({
      page_size: '50',
      order_by: 'EditedTime',
      direction: 'DESC',
      folder_token: folderToken,
    });
    if (pageToken) {
      query.set('page_token', pageToken);
    }

    const data = await feishuFetch<{
      files?: FeishuDriveItem[];
      has_more?: boolean;
      page_token?: string;
      next_page_token?: string;
    }>(accessToken, `/drive/v1/files?${query.toString()}`);

    const items = Array.isArray(data.files) ? data.files : [];
    all.push(...items);

    const hasMore = !!data.has_more;
    pageToken = data.page_token || data.next_page_token || '';
    if (!hasMore || !pageToken) break;
  }

  return all;
}

async function mirrorFolderToLocal(
  userAccessToken: string,
  folderToken: string,
  localDir: string,
  queueFiles: QueueFile[],
  stats: MirrorStats,
  maxFiles: number,
  visitedFolders: Set<string>,
): Promise<void> {
  if (stats.truncated || queueFiles.length >= maxFiles) {
    stats.truncated = true;
    return;
  }
  if (!folderToken || visitedFolders.has(folderToken)) return;
  visitedFolders.add(folderToken);

  const items = await listFolderItems(userAccessToken, folderToken);
  for (const raw of items) {
    if (stats.truncated || queueFiles.length >= maxFiles) {
      stats.truncated = true;
      break;
    }

    const token = raw.token || raw.node_token || raw.obj_token || '';
    const type = (raw.type || raw.obj_type || '').trim().toLowerCase();
    const title = (raw.name || raw.title || token || 'Untitled').trim();
    if (!token || !type) {
      stats.skipped += 1;
      continue;
    }

    if (type === 'folder') {
      stats.folders += 1;
      const subDir = path.join(localDir, safeName(title));
      await fs.mkdir(subDir, { recursive: true });
      await mirrorFolderToLocal(userAccessToken, token, subDir, queueFiles, stats, maxFiles, visitedFolders);
      continue;
    }

    if (DOC_TYPES.has(type)) {
      stats.docs += 1;
      const reference: FeishuDocReference = {
        token,
        type,
        title: title || `Feishu-${token.slice(0, 8)}`,
        url: buildDocUrl(type, token, raw.url),
        attachedAt: new Date().toISOString(),
      };

      let markdown = buildFeishuReferenceMarkdown(reference);
      try {
        const exported = await exportFeishuDocumentMarkdown(userAccessToken, token, type);
        const finalTitle = exported.title || reference.title;
        if ((exported.markdown || '').trim()) {
          markdown = [
            `# ${finalTitle}`,
            '',
            `Source: ${reference.url}`,
            `Imported At: ${new Date().toLocaleString()}`,
            '',
            '---',
            '',
            exported.markdown.trim(),
            '',
          ].join('\n');
        }
      } catch {
        // Keep reference markdown fallback
      }

      const preferred = `${safeName(title || `doc-${token.slice(0, 6)}`)}-${token.slice(0, 6)}.md`;
      const filePath = await ensureUniquePath(localDir, preferred);
      await fs.writeFile(filePath, markdown, 'utf-8');
      queueFiles.push({
        filePath,
        sourceKey: `feishu:${token}`,
        fileSize: Buffer.byteLength(markdown, 'utf-8'),
      });
      continue;
    }

    if (type === 'file') {
      stats.files += 1;
      try {
        const buffer = await fetchDownload(userAccessToken, token);
        const ext = normalizeExt(raw.file_extension) || extFromName(title);
        const preferred = `${safeName(stripExt(title || `file-${token.slice(0, 6)}`))}-${token.slice(0, 6)}${ext}`;
        const filePath = await ensureUniquePath(localDir, preferred);
        await fs.writeFile(filePath, buffer);
        queueFiles.push({
          filePath,
          sourceKey: `feishu:file:${token}`,
          fileSize: buffer.byteLength,
        });
      } catch {
        stats.skipped += 1;
      }
      continue;
    }

    stats.skipped += 1;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ImportFolderBody;
    const folderToken = body.token?.trim();
    if (!folderToken) {
      return NextResponse.json({ error: 'MISSING_TOKEN', message: 'token is required' }, { status: 400 });
    }

    const auth = loadToken();
    if (!auth) {
      return NextResponse.json({ error: 'FEISHU_AUTH_REQUIRED', message: '请先登录飞书账号' }, { status: 401 });
    }
    if (Date.now() > auth.expiresAt) {
      return NextResponse.json({ error: 'FEISHU_AUTH_EXPIRED', message: '飞书登录已过期，请重新登录' }, { status: 401 });
    }

    const maxFiles = Math.min(Math.max(1, Number(body.maxFiles || DEFAULT_MAX_FILES)), MAX_ALLOWED_FILES);
    const maxFileSize = Math.max(1, Number(body.maxFileSize || DEFAULT_MAX_FILE_SIZE));
    const collectionId = body.collectionId?.trim() || ensureDefaultCollectionId();
    const folderTitle = body.title?.trim() || `feishu-folder-${folderToken.slice(0, 8)}`;

    const session = body.sessionId ? getSession(body.sessionId) : undefined;
    const workingDirectory = session?.working_directory?.trim() || '';
    const dataDir =
      process.env.LUMOS_DATA_DIR ||
      process.env.CLAUDE_GUI_DATA_DIR ||
      path.join(os.homedir(), '.lumos');

    const rootDir = workingDirectory
      ? path.join(workingDirectory, '.lumos-uploads', 'feishu-folders')
      : path.join(dataDir, '.lumos-uploads', 'feishu-folders');
    await fs.mkdir(rootDir, { recursive: true });

    const localFolderDir = path.join(rootDir, `${Date.now()}-${safeName(folderTitle)}-${folderToken.slice(0, 6)}`);
    await fs.mkdir(localFolderDir, { recursive: true });

    const queueFiles: QueueFile[] = [];
    const stats: MirrorStats = { folders: 0, docs: 0, files: 0, skipped: 0, truncated: false };
    await mirrorFolderToLocal(
      auth.userAccessToken,
      folderToken,
      localFolderDir,
      queueFiles,
      stats,
      maxFiles,
      new Set<string>(),
    );

    if (queueFiles.length === 0) {
      return NextResponse.json({
        error: 'NO_IMPORTABLE_FILES',
        message: '该飞书文件夹中没有可入库的文件',
      }, { status: 400 });
    }

    const job = createIngestJob({
      collectionId,
      sourceDir: localFolderDir,
      sourceType: 'directory',
      recursive: true,
      maxFiles,
      maxFileSize,
      forceReprocess: body.forceReprocess === true,
      files: queueFiles,
    });

    ensureKnowledgeIngestWorker();
    triggerKnowledgeIngestNow();

    return NextResponse.json({
      ok: true,
      queued: true,
      job,
      total: queueFiles.length,
      skipped: stats.skipped,
      folders: stats.folders,
      docs: stats.docs,
      files: stats.files,
      truncated: stats.truncated,
      localPath: localFolderDir,
      message: stats.truncated
        ? `已导入并排队前 ${queueFiles.length} 个文件（达到上限）`
        : `已导入并排队 ${queueFiles.length} 个文件`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to import feishu folder';
    return NextResponse.json({ error: 'INTERNAL_ERROR', message }, { status: 500 });
  }
}
