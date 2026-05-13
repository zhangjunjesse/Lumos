import { runScheduledCookieProbe } from './cookie-probe';
import { createJob, runJob } from './jobs';
import { listCreators, listKeywords } from './storage';
import type { CreatorCadence } from './types';

export interface PatrolReport {
  ok: boolean;
  scope: 'creators' | 'keywords';
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  reasons: string[];
  message: string;
}

const CADENCE_MS: Record<CreatorCadence, number> = {
  hourly: 60 * 60_000,
  daily: 24 * 60 * 60_000,
  weekly: 7 * 24 * 60 * 60_000,
  // `manual` cadence rows should not run on automated patrol — only on
  // explicit "立即采集" clicks. We model that with Infinity.
  manual: Number.POSITIVE_INFINITY,
};

/**
 * True when the row's cadence window has elapsed since `lastCheckedAt`,
 * or the row has never been checked. `manual` cadence always returns false
 * (those rows opt out of automation).
 */
export function shouldRunByCadence(
  cadence: CreatorCadence | undefined,
  lastCheckedAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const c = cadence ?? 'daily';
  if (c === 'manual') return false;
  const window = CADENCE_MS[c];
  if (!Number.isFinite(window)) return false;
  if (!lastCheckedAt) return true;
  const last = Date.parse(lastCheckedAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= window;
}

/**
 * Patrol all enabled creators that are due per their cadence. Skipping
 * recently-checked creators avoids burning rate-limit budget against
 * douyin and matches user expectations (a "weekly" subscription should
 * not be re-fetched every morning).
 */
export async function patrolEnabledCreators(): Promise<PatrolReport> {
  // Cookie health is the precondition for scrape success; the helper has
  // its own 1-hour cooldown so calling it here on every patrol fire is
  // cheap. We don't gate the patrol on its outcome (the public RENDER_DATA
  // path works without cookies for many creators) — but probing keeps
  // cookieLastOkAt fresh so the UI shows current health.
  await runScheduledCookieProbe().catch(() => undefined);

  const all = listCreators().filter((c) => c.enabled !== false);
  if (all.length === 0) {
    return emptyReport('creators', '没有启用的博主订阅，跳过本次巡更。');
  }
  const due = all.filter((c) => shouldRunByCadence(c.cadence, c.last_checked_at));
  const skipped = all.length - due.length;
  if (due.length === 0) {
    return {
      ok: true,
      scope: 'creators',
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped,
      reasons: [],
      message: `所有 ${all.length} 个启用的博主都还没到 cadence 间隔，跳过本次。`,
    };
  }
  return runQueue('creators', due.map((c) => c.id), 'creator', skipped);
}

/**
 * Patrol all enabled keywords that are due per their cadence. The keyword
 * search backend is still a stub, so each fired job currently returns the
 * documented "search 未接入" reason — the report aggregates them honestly.
 */
export async function patrolEnabledKeywords(): Promise<PatrolReport> {
  await runScheduledCookieProbe().catch(() => undefined);

  const all = listKeywords().filter((k) => k.enabled !== false);
  if (all.length === 0) {
    return emptyReport('keywords', '没有启用的关键词订阅，跳过本次巡更。');
  }
  const due = all.filter((k) => shouldRunByCadence(k.cadence, k.last_checked_at));
  const skipped = all.length - due.length;
  if (due.length === 0) {
    return {
      ok: true,
      scope: 'keywords',
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped,
      reasons: [],
      message: `所有 ${all.length} 个启用的关键词都还没到 cadence 间隔，跳过本次。`,
    };
  }
  return runQueue('keywords', due.map((k) => k.id), 'keyword', skipped);
}

function emptyReport(scope: PatrolReport['scope'], message: string): PatrolReport {
  return {
    ok: true,
    scope,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    reasons: [],
    message,
  };
}

/**
 * Failure reasons that mean "every subsequent job in this patrol will
 * fail the same way — stop burning rate-limit budget on them". Matched
 * against `failure_reason` substrings (case-insensitive).
 */
const FATAL_REASON_PATTERNS = [
  /cookie/i,           // "Cookie 失效" / "cookie expired"
  /风控/,              // "命中抖音风控"
  /not[-_ ]?configured/i,
  /HTTP 4\d\d/,        // 401/403/404 from douyin
  /HTTP 5\d\d/,        // 500-class is also worth aborting
  /网络/,              // 「网络错误」
];

function isFatalReason(reason: string | null | undefined): boolean {
  if (!reason) return false;
  return FATAL_REASON_PATTERNS.some((p) => p.test(reason));
}

async function runQueue(
  scope: PatrolReport['scope'],
  targetIds: string[],
  kind: 'creator' | 'keyword',
  skipped: number,
): Promise<PatrolReport> {
  const failures: string[] = [];
  let succeeded = 0;
  let abortedAfter: string | null = null;
  let processed = 0;
  for (const targetRef of targetIds) {
    if (abortedAfter) {
      // Short-circuit: every queued job after a fatal reason would just
      // hit the same error. Mark them as failed with a clear note.
      failures.push(`已跳过：${abortedAfter}`);
      continue;
    }
    try {
      const job = createJob({ kind, targetRef });
      const after = await runJob(job.id);
      processed += 1;
      if (after?.status === 'success') {
        succeeded += 1;
      } else if (after?.failure_reason) {
        failures.push(after.failure_reason);
        if (isFatalReason(after.failure_reason)) {
          abortedAfter = after.failure_reason;
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      failures.push(reason);
      processed += 1;
      if (isFatalReason(reason)) abortedAfter = reason;
    }
  }
  const failed = targetIds.length - succeeded;
  const distinctReasons = Array.from(new Set(failures)).slice(0, 3);
  const skippedSuffix = skipped > 0 ? ` · 跳过 ${skipped}（cadence 未到期）` : '';
  const abortSuffix = abortedAfter
    ? ` · 命中致命错误后短路（处理 ${processed} / ${targetIds.length}）`
    : '';
  // Round 175: localize scope name in user-facing message. Internal
  // identifier stays English (used for filtering / metrics) but the
  // toast user sees should be 中文 to match the rest of the app copy.
  const scopeLabel = scope === 'creators' ? '博主' : '关键词';
  const message =
    failed === 0
      ? `${scopeLabel}巡更：${succeeded} / ${targetIds.length} 成功${skippedSuffix}。`
      : `${scopeLabel}巡更：${succeeded} 成功 / ${failed} 失败${skippedSuffix}${abortSuffix}${
          distinctReasons.length > 0 ? `（${distinctReasons.join('；')}）` : ''
        }`;
  return {
    ok: failed === 0,
    scope,
    processed: targetIds.length,
    succeeded,
    failed,
    skipped,
    reasons: distinctReasons,
    message,
  };
}
