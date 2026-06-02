// 运行日志：GET 列最近 500 条(时间倒序)，DELETE 清空。排查图片生成成败用。

import { NextResponse } from 'next/server';
import { getEtsyForgeStore } from '@/lib/etsy-forge/store';
import { COLLECTIONS, type LogRow } from '@/lib/etsy-forge/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const store = getEtsyForgeStore();
    const rows = store.query<LogRow>(COLLECTIONS.LOGS, {
      orderBy: { field: 'created_at', direction: 'desc' },
      limit: 500,
    });
    return NextResponse.json({
      logs: rows.map((r) => ({
        id: r.id,
        level: r.level,
        scope: r.scope,
        product: r.product ?? null,
        images: Array.isArray(r.images) ? r.images : [],
        message: r.message,
        created_at: r.created_at,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const store = getEtsyForgeStore();
    const rows = store.query<LogRow>(COLLECTIONS.LOGS, { limit: 10000 });
    for (const r of rows) store.delete(COLLECTIONS.LOGS, r.id);
    return NextResponse.json({ ok: true, deleted: rows.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
