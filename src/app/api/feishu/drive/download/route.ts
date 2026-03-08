import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadToken } from '@/lib/feishu-auth';
import { getSession } from '@/lib/db/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FEISHU_BASE_URL = 'https://open.feishu.cn/open-apis';

interface DownloadBody {
  token?: string;
  title?: string;
  name?: string;
  sessionId?: string;
}

function safeName(input: string): string {
  return input.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'feishu-file';
}

function extFromName(name?: string): string {
  if (!name) return '';
  const idx = name.lastIndexOf('.');
  if (idx === -1) return '';
  const ext = name.slice(idx);
  return ext.length <= 10 ? ext : '';
}

async function fetchDownload(accessToken: string, token: string): Promise<{ buffer: Buffer; contentType: string | null }> {
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

  const arrayBuffer = await res.arrayBuffer();
  const finalContentType = res.headers.get('content-type');
  return { buffer: Buffer.from(arrayBuffer), contentType: finalContentType };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DownloadBody;
    const token = body.token?.trim();
    if (!token) {
      return NextResponse.json({ error: 'MISSING_TOKEN', message: 'token is required' }, { status: 400 });
    }

    const auth = loadToken();
    if (!auth) {
      return NextResponse.json({ error: 'FEISHU_AUTH_REQUIRED', message: '请先登录飞书账号' }, { status: 401 });
    }
    if (Date.now() > auth.expiresAt) {
      return NextResponse.json({ error: 'FEISHU_AUTH_EXPIRED', message: '飞书登录已过期，请重新登录' }, { status: 401 });
    }

    const fileTitle = body.title?.trim() || body.name?.trim() || `Feishu-${token.slice(0, 8)}`;
    const fileExt = extFromName(body.name) || '';

    const session = body.sessionId ? getSession(body.sessionId) : undefined;
    const workingDirectory = session?.working_directory?.trim() || '';
    const dataDir =
      process.env.LUMOS_DATA_DIR ||
      process.env.CLAUDE_GUI_DATA_DIR ||
      path.join(os.homedir(), '.lumos');

    const outputDir = workingDirectory
      ? path.join(workingDirectory, '.lumos-uploads', 'feishu-files')
      : path.join(dataDir, '.lumos-uploads', 'feishu-files');
    await fs.mkdir(outputDir, { recursive: true });

    const { buffer } = await fetchDownload(auth.userAccessToken, token);
    const fileName = `${Date.now()}-${safeName(fileTitle)}${fileExt}`;
    const filePath = path.join(outputDir, fileName);
    await fs.writeFile(filePath, buffer);

    return NextResponse.json({
      ok: true,
      filePath,
      fileName,
      title: fileTitle,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to download feishu file';
    return NextResponse.json({ error: 'INTERNAL_ERROR', message }, { status: 500 });
  }
}
