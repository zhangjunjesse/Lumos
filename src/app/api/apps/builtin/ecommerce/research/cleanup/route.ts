import { NextRequest, NextResponse } from 'next/server';

import { cleanupReports } from '@/lib/ecommerce-assistant/research-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 批量清理终态调研报告（失败 / 已取消）。已完成报告不参与（调研产出）。
 * body: { statuses?: ('failed'|'cancelled')[] } —— 缺省清理全部可清理终态。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { statuses?: unknown };
    const statuses = Array.isArray(body.statuses)
      ? body.statuses.map((s) => String(s).trim()).filter(Boolean)
      : undefined;
    const removed = cleanupReports(statuses);
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
