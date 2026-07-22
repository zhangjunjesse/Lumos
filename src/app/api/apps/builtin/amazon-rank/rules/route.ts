import { NextRequest, NextResponse } from 'next/server';

import { getAmazonRankAppContext } from '@/lib/amazon-rank/app-store';
import {
  adoptDraftRules,
  dismissDraftRules,
  getActiveRules,
  getDraftRules,
  rollbackToBuiltinRules,
} from '@/lib/amazon-rank/extraction-rules';
import { countOpenRepairTickets, resolveOpenRepairTickets } from '@/lib/amazon-rank/repair-tickets';

export const dynamic = 'force-dynamic';

/**
 * 提取规则状态与生命周期：
 * GET  当前生效版本 / 待确认草稿 / 未决修复工单数
 * POST { action: 'adopt' | 'dismiss' | 'rollback', id? } —
 *      采用草稿（同时解决未决工单）/ 忽略草稿 / 回滚出厂基线
 */

function snapshot(store: ReturnType<typeof getAmazonRankAppContext>['store']) {
  const active = getActiveRules(store);
  const draft = getDraftRules(store);
  return {
    active: { version: active.version, source: active.source, rules: active.rules },
    draft: draft
      ? {
          id: draft.id,
          version: draft.version,
          note: draft.note ?? '',
          validatedKeywords: draft.validated_keywords ?? [],
          createdAt: draft.created_at,
          rules: draft.rules,
        }
      : null,
    openTickets: countOpenRepairTickets(store),
  };
}

export async function GET() {
  try {
    const ctx = getAmazonRankAppContext();
    return NextResponse.json(snapshot(ctx.store));
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = getAmazonRankAppContext();
    const body = (await req.json().catch(() => null)) as { action?: string; id?: string } | null;
    if (!body?.action) return NextResponse.json({ error: '缺少 action' }, { status: 400 });

    if (body.action === 'adopt') {
      if (!body.id) return NextResponse.json({ error: '缺少草稿 id' }, { status: 400 });
      const adopted = adoptDraftRules(ctx.store, body.id);
      const resolved = resolveOpenRepairTickets(ctx.store, adopted.version);
      return NextResponse.json({ ...snapshot(ctx.store), resolvedTickets: resolved });
    }
    if (body.action === 'dismiss') {
      if (!body.id) return NextResponse.json({ error: '缺少草稿 id' }, { status: 400 });
      dismissDraftRules(ctx.store, body.id);
      return NextResponse.json(snapshot(ctx.store));
    }
    if (body.action === 'rollback') {
      rollbackToBuiltinRules(ctx.store);
      return NextResponse.json(snapshot(ctx.store));
    }
    return NextResponse.json({ error: `未知 action：${body.action}` }, { status: 400 });
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
