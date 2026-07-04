import { NextResponse } from 'next/server';

import { MONITOR_NATIVE_ACTION } from '@/lib/amazon-rank/constants';
import { getAmazonRankAppContext } from '@/lib/amazon-rank/app-store';
import { getActiveRunId } from '@/lib/amazon-rank/run-manager';
import { getWatchlist } from '@/lib/amazon-rank/settings';
import { listRuns } from '@/lib/amazon-rank/store';
import {
  checkBrowserBridgeReady,
  resolveBrowserBridgeRuntimeConfig,
} from '@/lib/browser-runtime/bridge-client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ctx = getAmazonRankAppContext();

    const config = resolveBrowserBridgeRuntimeConfig();
    const bridge = config
      ? await checkBrowserBridgeReady(config)
      : { ready: false, status: 0, error: 'Browser Bridge 未配置（Lumos 桌面端未启动）' };

    const watchlist = getWatchlist(ctx.store);
    const runs = listRuns(ctx.store, 1);
    const lastRun = runs[0] ?? null;
    const activeRunId = getActiveRunId();
    const automation = ctx.store
      .query<{ enabled?: boolean; schedule_status?: string; native_action?: string }>('app_automations', { limit: 100 })
      .find((row) => row.native_action === MONITOR_NATIVE_ACTION);

    const phase = !ctx.installed
      ? 'not_installed'
      : !bridge.ready
        ? 'not_connected'
        : activeRunId
          ? 'running'
          : lastRun
            ? 'ready'
            : 'not_configured';

    return NextResponse.json({
      app: ctx.installed
        ? { id: ctx.appId, version: ctx.version, status: 'installed' }
        : { id: ctx.appId, version: null, status: 'not_installed' },
      bridge: { connected: bridge.ready, error: bridge.error ?? null },
      activeRunId,
      lastRun: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            keywordsTotal: lastRun.keywords_total,
            matchesTotal: lastRun.matches_total,
            startedAt: lastRun.started_at,
          }
        : null,
      watchlist: { keywords: watchlist.keywords.length, asins: watchlist.asins.length },
      monitor: automation
        ? { enabled: automation.enabled === true, scheduleStatus: automation.schedule_status ?? 'not_connected' }
        : null,
      ready: phase === 'ready' || phase === 'running',
      phase,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
