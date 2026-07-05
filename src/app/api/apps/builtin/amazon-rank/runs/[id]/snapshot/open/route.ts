import { NextRequest, NextResponse } from 'next/server';

import { getAmazonRankAppContext } from '@/lib/amazon-rank/app-store';
import { openSnapshotInSettingsBrowser } from '@/lib/amazon-rank/snapshot-open';

export const dynamic = 'force-dynamic';

/** 在设置里选定的浏览器中打开快照（body: { resultId }） */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { resultId?: string } | null;
    const resultId = body?.resultId?.trim() ?? '';
    if (!resultId) return NextResponse.json({ error: '缺少 resultId' }, { status: 400 });

    const ctx = getAmazonRankAppContext();
    const outcome = await openSnapshotInSettingsBrowser(ctx.store, {
      runId: id,
      resultId,
      origin: req.nextUrl.origin,
    });
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.error }, { status: 502 });
    }
    return NextResponse.json({ ok: true, browserContextId: outcome.browserContextId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
