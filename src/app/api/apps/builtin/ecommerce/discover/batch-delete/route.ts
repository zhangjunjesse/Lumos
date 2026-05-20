import { NextRequest, NextResponse } from 'next/server';

import { deleteResearchRunsByIds } from '@/lib/ecommerce-assistant/discover-lifecycle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 批量删除选品研究记录（按 UI 显式勾选的 research run id）。每个 run 走
 * cancel-then-delete：先中断仍在跑的后台研究，再删该 research_id 名下全部候选。
 * promoted 候选已转入工坊（流水线追溯），跳过不删并计数（区别于单删的 409）。
 * body: { research_ids: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { research_ids?: unknown };
    const ids = Array.isArray(body.research_ids)
      ? body.research_ids.map((s) => String(s).trim()).filter(Boolean)
      : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: '必须提供要删除的 research_ids。' }, { status: 400 });
    }
    const result = deleteResearchRunsByIds(ids);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
