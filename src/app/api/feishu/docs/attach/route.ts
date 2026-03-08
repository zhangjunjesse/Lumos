import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadToken } from '@/lib/feishu-auth';
import { getSession } from '@/lib/db/sessions';
import {
  buildFeishuAttachFallback,
  buildFeishuReferenceMarkdown,
  exportFeishuDocumentMarkdown,
  type FeishuDocReference,
} from '@/lib/feishu/doc-content';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AttachBody {
  sessionId?: string;
  token?: string;
  type?: string;
  title?: string;
  url?: string;
  mode?: 'reference' | 'full';
}

const TYPE_PATH: Record<string, string> = {
  doc: 'doc',
  docx: 'docx',
  sheet: 'sheets',
  bitable: 'base',
  wiki: 'wiki',
};

function safeName(input: string): string {
  return input.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'feishu-doc';
}

function buildDocUrl(type: string, token: string): string {
  const seg = TYPE_PATH[type];
  if (!seg || !token) return '';
  return `https://feishu.cn/${seg}/${token}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AttachBody;
    const token = body.token?.trim();
    const type = (body.type || 'docx').trim();
    const mode = body.mode === 'full' ? 'full' : 'reference';

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

    const docTitle = body.title?.trim() || `Feishu-${token.slice(0, 8)}`;
    const docUrl = body.url?.trim() || '';
    const reference: FeishuDocReference = {
      token,
      type,
      title: docTitle,
      url: docUrl || buildDocUrl(type, token) || `https://feishu.cn/docx/${token}`,
      attachedAt: new Date().toISOString(),
    };

    let markdown = buildFeishuReferenceMarkdown(reference);
    let warning: string | null = null;

    if (mode === 'full') {
      try {
        const exported = await exportFeishuDocumentMarkdown(auth.userAccessToken, token, type);
        const finalTitle = body.title?.trim() || exported.title || docTitle;
        markdown = [
          `# ${finalTitle}`,
          '',
          docUrl ? `Source: ${docUrl}` : '',
          `Imported At: ${new Date().toLocaleString()}`,
          '',
          '---',
          '',
          exported.markdown || '_This document type cannot be fully extracted. Attached as reference._',
          '',
        ]
          .filter(Boolean)
          .join('\n');
      } catch (error) {
        warning = buildFeishuAttachFallback(error);
        markdown = [
          buildFeishuReferenceMarkdown(reference),
          '',
          `_${warning}_`,
          '',
        ].join('\n');
      }
    }

    const session = body.sessionId ? getSession(body.sessionId) : undefined;
    const workingDirectory = session?.working_directory?.trim() || '';
    const dataDir =
      process.env.LUMOS_DATA_DIR ||
      process.env.CLAUDE_GUI_DATA_DIR ||
      path.join(os.homedir(), '.lumos');

    const outputDir = workingDirectory
      ? path.join(workingDirectory, '.lumos-uploads', 'feishu-docs')
      : path.join(dataDir, '.lumos-uploads', 'feishu-docs');
    await fs.mkdir(outputDir, { recursive: true });

    const suffix = mode === 'reference' ? 'ref' : 'full';
    const fileName = `${Date.now()}-${safeName(docTitle)}-${suffix}.md`;
    const filePath = path.join(outputDir, fileName);
    await fs.writeFile(filePath, markdown, 'utf-8');

    return NextResponse.json({
      ok: true,
      filePath,
      fileName,
      title: docTitle,
      sourceUrl: docUrl || null,
      warning,
      mode,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to attach feishu document';
    return NextResponse.json({ error: 'INTERNAL_ERROR', message }, { status: 500 });
  }
}
