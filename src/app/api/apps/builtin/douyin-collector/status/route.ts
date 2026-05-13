import { NextResponse } from 'next/server';

import { getAppPlatformService } from '@/lib/app/service';
import {
  aggregateAsrSpend,
  countLibraryStatus,
  countQueue,
  getDouyinCollectorStore,
  getLastPublishedAt,
  listCreators,
  listKeywords,
  type AsrSpend,
} from '@/lib/douyin-collector/storage';
import { getSetting } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Status snapshot for the Douyin Collector built-in app.
 *
 * Skeleton stage: real auth / job state will land in a later iteration.
 * For now we surface install state honestly so the apps card and Hero
 * can render `not_configured` instead of pretending things are ready.
 */
export async function GET() {
  let installedVersion: string | null = null;
  let installError: string | null = null;
  try {
    const svc = getAppPlatformService();
    const row = svc.db
      .prepare('SELECT version FROM lumos_app_apps WHERE id = ?')
      .get('douyin-collector') as { version: string } | undefined;
    installedVersion = row?.version ?? null;
  } catch (err) {
    installError = err instanceof Error ? err.message : String(err);
  }

  const installed = installedVersion !== null;
  let creatorCount = 0;
  let keywordCount = 0;
  let creatorsEnabled = 0;
  let keywordsEnabled = 0;
  let queue = {
    runningJobs: 0,
    pendingJobs: 0,
    lastRunFailure: null as string | null,
    lastRunAt: null as string | null,
    lastPatrolAt: null as string | null,
  };
  let library: {
    videos: number;
    drafts: number;
    published: number;
    unprocessed?: number;
    discarded?: number;
    lastPublishedAt?: string | null;
  } = { videos: 0, drafts: 0, published: 0 };
  let asrSpend: AsrSpend = {
    totalAmount: 0,
    videoCount: 0,
    last30dAmount: 0,
    last30dVideoCount: 0,
  };
  let hasActiveSchedule = false;
  let storeError: string | null = null;
  if (installed) {
    try {
      const store = getDouyinCollectorStore();
      const creators = listCreators(store);
      const keywords = listKeywords(store);
      creatorCount = creators.length;
      keywordCount = keywords.length;
      creatorsEnabled = creators.filter((c) => c.enabled !== false).length;
      keywordsEnabled = keywords.filter((k) => k.enabled !== false).length;
      // "active schedule" = at least one enabled subscription with a
      // non-manual cadence. Drives the patrol-stale warning on Hero.
      hasActiveSchedule = creators
        .concat(keywords as unknown as typeof creators)
        .some((row) => row.enabled !== false && row.cadence && row.cadence !== 'manual');
      queue = countQueue(store);
      library = { ...countLibraryStatus(store), lastPublishedAt: getLastPublishedAt(store) };
      asrSpend = aggregateAsrSpend(store);
    } catch (err) {
      storeError = err instanceof Error ? err.message : String(err);
    }
  }

  const cookieRaw = getSetting('douyin_collector_cookie') ?? '';
  const cookieValid = cookieRaw.trim().length > 0;

  // Transcribe path readiness: native subtitles always work (public URL),
  // but the ASR fallback needs (a) a speech provider override and (b) a
  // logged-in lumos cloud session. Surface these so the health panel
  // tells the user the truth instead of claiming "ASR ready" by default.
  let speechProviderConfigured = false;
  let cloudLoggedIn = false;
  try {
    const { resolveCloudSpeechProvider } = await import('@/lib/im/core/asr-adapters/cloud-speech');
    const { getActiveWebSessionToken } = await import('@/lib/auth/user-service');
    speechProviderConfigured = (await resolveCloudSpeechProvider()) !== null;
    cloudLoggedIn = !!getActiveWebSessionToken();
  } catch { /* best-effort: leave both false on failure */ }
  // Treat empty string as null so consumers don't need to know the
  // settings store distinguishes "never set" (null) from "explicitly
  // cleared" (empty string after Round 150 cookie-replace invalidation).
  const cookieCheckedAt = (getSetting('douyin_collector_cookie_checked_at') ?? '') || null;
  const cookieLastOkAt = (getSetting('douyin_collector_cookie_last_ok_at') ?? '') || null;
  // Cookie is now optional: public share-page RENDER_DATA scrape works
  // without auth. Phase=ready as long as the user has at least one source
  // configured. Cookie absence shows in 健康度 panel as a soft warning.
  const phase = !installed
    ? 'needs-install'
    : queue.runningJobs > 0
      ? 'syncing'
      : queue.lastRunFailure
        ? 'failed'
        : creatorCount + keywordCount > 0
          ? 'ready'
          : 'not_configured';
  const ready = phase === 'ready' || phase === 'syncing';

  return NextResponse.json({
    app: {
      id: 'douyin-collector',
      name: '抖音采集器',
      version: installedVersion ?? '0.0.1',
      source: 'builtin',
      category: 'research',
      status: phase,
    },
    install: {
      installed,
      version: installedVersion,
      error: installError ?? storeError,
    },
    auth: {
      ready: cookieValid,
      cookieValid,
      lastCheckedAt: cookieCheckedAt ?? null,
      lastOkAt: cookieLastOkAt ?? null,
    },
    sources: {
      creators: creatorCount,
      keywords: keywordCount,
      creatorsEnabled,
      keywordsEnabled,
      hasActiveSchedule,
    },
    queue,
    library,
    transcribe: {
      speechProviderConfigured,
      cloudLoggedIn,
      asrReady: speechProviderConfigured && cloudLoggedIn,
    },
    asrSpend,
    ready,
    phase,
  });
}
