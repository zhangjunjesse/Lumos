import { NextRequest, NextResponse } from 'next/server';

import {
  parseAsinsText,
  parseExcelBuffer,
  parseKeywordsText,
} from '@/lib/amazon-rank/input-parser';

export const dynamic = 'force-dynamic';

/**
 * 输入解析预览：POST multipart（file + kind）或 JSON（{ kind, text }）。
 * 返回 { items, warnings }，前端回显给用户确认后才会启动查询。
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || '';

    if (contentType.startsWith('multipart/form-data')) {
      const form = await req.formData();
      const kind = normalizeKind(form.get('kind'));
      const file = form.get('file');
      if (!kind) return badRequest('kind 必须是 keywords 或 asins');
      if (!(file instanceof File)) return badRequest('缺少上传文件');
      if (file.size > 10 * 1024 * 1024) return badRequest('文件太大（超过 10MB）');
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = await parseExcelBuffer(buffer, kind);
      return NextResponse.json(parsed);
    }

    const body = (await req.json().catch(() => null)) as { kind?: string; text?: string } | null;
    const kind = normalizeKind(body?.kind);
    if (!kind) return badRequest('kind 必须是 keywords 或 asins');
    const text = typeof body?.text === 'string' ? body.text : '';
    const parsed = kind === 'keywords' ? parseKeywordsText(text) : parseAsinsText(text);
    return NextResponse.json(parsed);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

function normalizeKind(value: unknown): 'keywords' | 'asins' | null {
  return value === 'keywords' || value === 'asins' ? value : null;
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
