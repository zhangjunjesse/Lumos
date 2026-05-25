import fs from 'node:fs';
import path from 'node:path';

import { NextRequest, NextResponse } from 'next/server';

import { getDb } from '@/lib/db/connection';
import { getRun } from '@/lib/pinterest-radar/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ReportRow {
  id: number;
  file_path: string;
  term_count: number;
  size_bytes: number;
  generated_at: number;
}

/** GET 元数据 + 直接流 PDF。?file=1 时返回 PDF 内容,否则返回 JSON 元数据。 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!getRun(id)) return NextResponse.json({ error: 'run not found' }, { status: 404 });

  // 取该 run 最新一个 report
  const row = getDb().prepare(
    `SELECT id, file_path, term_count, size_bytes, generated_at
       FROM pinterest_reports WHERE run_id = ? ORDER BY generated_at DESC LIMIT 1`,
  ).get(id) as ReportRow | undefined;
  if (!row) return NextResponse.json({ error: 'no report yet' }, { status: 404 });

  if (!fs.existsSync(row.file_path)) {
    return NextResponse.json({ error: `报告文件已不在磁盘: ${row.file_path}` }, { status: 410 });
  }

  const wantsFile = new URL(req.url).searchParams.get('file') === '1';
  if (!wantsFile) {
    return NextResponse.json({
      filePath: row.file_path,
      fileName: path.basename(row.file_path),
      termCount: row.term_count,
      sizeBytes: row.size_bytes,
      generatedAt: row.generated_at,
    });
  }

  // 读 PDF 整个 buffer 返回(报告通常 1-5 MB,一次读 OK)
  const buf = fs.readFileSync(row.file_path);
  // toString('latin1') 是把 Buffer 直接当字节序列序列化,避免 fetch 改编码
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(buf.length),
      'Content-Disposition': `inline; filename="${encodeURIComponent(path.basename(row.file_path))}"`,
      'Cache-Control': 'no-store',
    },
  });
}
