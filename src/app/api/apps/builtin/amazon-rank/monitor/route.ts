import { NextRequest, NextResponse } from 'next/server';

import type { AmazonRankAutomationRow } from '@/lib/app/amazon-rank-default-automations';
import { syncNativeAppAutomationSchedule } from '@/lib/app/native-automation-scheduler';
import { getAmazonRankAppContext } from '@/lib/amazon-rank/app-store';
import { MONITOR_NATIVE_ACTION } from '@/lib/amazon-rank/constants';
import { parseAsinsText, parseKeywordsText } from '@/lib/amazon-rank/input-parser';
import { setWatchlist } from '@/lib/amazon-rank/settings';

export const dynamic = 'force-dynamic';

/**
 * 「设为每日监控」一步到位：存监控清单 → 启用每日自动化 → 同步定时任务。
 * 用户在结果页确认点击后调用（写操作先确认的入口在 UI 弹窗）。
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = getAmazonRankAppContext();
    if (!ctx.manifest) {
      return NextResponse.json({ error: '应用还没安装完成，请重启 Lumos 后再试' }, { status: 500 });
    }

    const body = (await req.json().catch(() => null)) as
      | { keywords?: string[]; asins?: string[] }
      | null;
    const keywords = parseKeywordsText((body?.keywords ?? []).join('\n')).items;
    const asins = parseAsinsText((body?.asins ?? []).join('\n')).items;
    if (keywords.length === 0 || asins.length === 0) {
      return NextResponse.json({ error: '监控清单需要至少 1 个关键词和 1 个 ASIN' }, { status: 400 });
    }

    const watchlist = setWatchlist(ctx.store, { keywords, asins });

    const automation = ctx.store
      .query<AmazonRankAutomationRow>('app_automations', { limit: 100 })
      .find((row) => row.native_action === MONITOR_NATIVE_ACTION);
    if (!automation) {
      return NextResponse.json({ error: '没有找到每日监控自动化，请重启 Lumos 后再试' }, { status: 500 });
    }

    ctx.store.update<AmazonRankAutomationRow>('app_automations', automation.id, {
      enabled: true,
      updated_at: new Date().toISOString(),
    });

    const schedule = await syncNativeAppAutomationSchedule({
      appId: ctx.appId,
      manifest: ctx.manifest,
      store: ctx.store,
      rowId: automation.id,
    });

    const updated = ctx.store.get<AmazonRankAutomationRow>('app_automations', automation.id);
    return NextResponse.json({ watchlist, automation: updated, schedule });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
