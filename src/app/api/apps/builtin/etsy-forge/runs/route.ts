// 运行结果：列表采集 / 详情采集批次记录。

import { NextRequest, NextResponse } from 'next/server';
import { getEtsyForgeStore, getStorageUserId } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type RunRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const kind = url.searchParams.get('kind') ?? undefined;
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));

    const store = getEtsyForgeStore();
    const filter: Record<string, unknown> = { user_id: getStorageUserId(req) };
    if (kind) filter.kind = kind;

    const rows = store.query<RunRow>(COLLECTIONS.RUNS, {
      filter,
      orderBy: { field: 'started_at', direction: 'desc' },
      limit,
    });

    return NextResponse.json({
      runs: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        keyword: r.keyword,
        products_found: r.products_found,
        ehunt_ok_count: r.ehunt_ok_count,
        images_collected: r.images_collected,
        status: r.status,
        failure_reason: r.failure_reason,
        started_at: r.started_at,
        ended_at: r.ended_at,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
