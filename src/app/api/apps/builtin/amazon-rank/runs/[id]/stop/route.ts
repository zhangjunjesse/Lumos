import { NextRequest, NextResponse } from 'next/server';

import { stopRankRun } from '@/lib/amazon-rank/run-manager';

export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const stopped = stopRankRun(id);
  if (!stopped) {
    return NextResponse.json({ error: '这个运行不在进行中' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
