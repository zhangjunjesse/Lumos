import { NextRequest, NextResponse } from 'next/server';

import type { AmazonRankAutomationRow } from '@/lib/app/amazon-rank-default-automations';
import { getAmazonRankAppContext } from '@/lib/amazon-rank/app-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = getAmazonRankAppContext();
    const automations = ctx.store.query<AmazonRankAutomationRow>('app_automations', {
      orderBy: { field: 'title', direction: 'asc' },
      limit: 100,
    });
    return NextResponse.json({ automations });
  } catch (error) {
    return serverError(error);
  }
}

/** 只允许改启用开关和触发规则；运行 / 同步定时走通用 native-actions 接口 */
export async function PATCH(req: NextRequest) {
  try {
    const ctx = getAmazonRankAppContext();
    const body = (await req.json().catch(() => null)) as
      | { id?: string; enabled?: boolean; schedule?: string }
      | null;
    if (!body?.id) return NextResponse.json({ error: '缺少自动化 id' }, { status: 400 });

    const existing = ctx.store.get<AmazonRankAutomationRow>('app_automations', body.id);
    if (!existing) return NextResponse.json({ error: '自动化不存在' }, { status: 404 });

    const patch: Partial<AmazonRankAutomationRow> = { updated_at: new Date().toISOString() };
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.schedule === 'string' && body.schedule.trim()) patch.schedule = body.schedule.trim();

    const updated = ctx.store.update<AmazonRankAutomationRow>('app_automations', body.id, patch);
    return NextResponse.json({ automation: updated });
  } catch (error) {
    return serverError(error);
  }
}

function serverError(error: unknown) {
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 },
  );
}
