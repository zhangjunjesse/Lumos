import { NextRequest, NextResponse } from 'next/server';

import { getAmazonRankAppContext } from '@/lib/amazon-rank/app-store';
import { getRun, getRunResults } from '@/lib/amazon-rank/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = getAmazonRankAppContext();
    const run = getRun(ctx.store, id);
    if (!run) return NextResponse.json({ error: '运行不存在' }, { status: 404 });
    return NextResponse.json({ run, results: getRunResults(ctx.store, id) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
