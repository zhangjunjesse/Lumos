import { NextRequest, NextResponse } from 'next/server';

import { deleteReportsByIds } from '@/lib/ecommerce-assistant/research-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 批量删除调研报告（按 UI 显式勾选的 id）。每个 id 走 cancel-then-delete：
 * 先中断正在运行的后台任务，再删可见记录与磁盘 md。
 * body: { ids: string[] } —— 任意状态可删（含已完成产出，区别于 /cleanup）。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.map((s) => String(s).trim()).filter(Boolean)
      : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: '必须提供要删除的 ids。' }, { status: 400 });
    }
    const removed = deleteReportsByIds(ids);
    return NextResponse.json({ ok: true, removed });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
