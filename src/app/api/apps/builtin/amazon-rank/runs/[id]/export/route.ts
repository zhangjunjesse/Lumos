import fs from 'node:fs';

import { NextRequest, NextResponse } from 'next/server';

import { getAmazonRankAppContext } from '@/lib/amazon-rank/app-store';
import { exportRunExcel } from '@/lib/amazon-rank/excel-export';
import { assertInsideAppOutput } from '@/lib/amazon-rank/paths';
import { getRun, getRunResults } from '@/lib/amazon-rank/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = getAmazonRankAppContext();
    const run = getRun(ctx.store, id);
    if (!run) return NextResponse.json({ error: '运行不存在' }, { status: 404 });
    if (run.status === 'running') {
      return NextResponse.json({ error: '运行还没结束，结束后再导出' }, { status: 409 });
    }

    const filePath = await exportRunExcel(run, getRunResults(ctx.store, id));
    assertInsideAppOutput(filePath);
    const buf = fs.readFileSync(filePath);
    const date = (run.started_at ?? '').slice(0, 10).replace(/-/g, '');
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="amazon_rank_${date || 'export'}_${id.slice(0, 8)}.xlsx"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
