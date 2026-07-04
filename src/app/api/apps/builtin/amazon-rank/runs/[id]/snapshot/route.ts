import fs from 'node:fs';

import { NextRequest, NextResponse } from 'next/server';

import { getAmazonRankAppContext } from '@/lib/amazon-rank/app-store';
import { assertInsideAppOutput } from '@/lib/amazon-rank/paths';
import { getRunResults } from '@/lib/amazon-rank/store';

export const dynamic = 'force-dynamic';

/** 返回某个关键词查询时的网页快照（?resultId=），带 CSP sandbox 只读呈现 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const resultId = req.nextUrl.searchParams.get('resultId') ?? '';
    if (!resultId) return NextResponse.json({ error: '缺少 resultId' }, { status: 400 });

    const ctx = getAmazonRankAppContext();
    const result = getRunResults(ctx.store, id).find((row) => row.id === resultId);
    if (!result) return NextResponse.json({ error: '结果不存在' }, { status: 404 });
    if (!result.snapshot_path) {
      return NextResponse.json({ error: '这个关键词没有留下快照' }, { status: 404 });
    }

    assertInsideAppOutput(result.snapshot_path);
    if (!fs.existsSync(result.snapshot_path)) {
      return NextResponse.json({ error: '快照文件已不存在' }, { status: 404 });
    }
    const html = fs.readFileSync(result.snapshot_path, 'utf-8');
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': 'sandbox',
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
