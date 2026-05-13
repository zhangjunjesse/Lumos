import { getDouyinCollectorSettings, markCookieOk } from './settings';
import { getDouyinCollectorStore } from './storage';

const PROBE_URL = 'https://www.iesdouyin.com/web/api/v2/aweme/iteminfo/?item_ids=0';
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const RUN_HISTORY_COLLECTION = 'run_history';
const PROBE_COOLDOWN_MS = 60 * 60_000;

export interface ProbeOutcome {
  ok: boolean;
  status?: number;
  message: string;
  bodyPreview?: string;
}

/**
 * Probe iesdouyin's public iteminfo endpoint with the supplied cookie.
 * Pure HTTP — does NOT touch settings / store. Honest contract:
 *   - ok=true on HTTP 200; we treat that as "cookie didn't get hard-rejected"
 *   - ok=false on 3xx (redirected to login = expired cookie), 4xx/5xx (rejection / risk-control)
 *   - ok=false on network error (returned with message detail)
 *
 * The shared bare endpoint between the manual test-cookie route and the
 * scheduled patrol probe — both call this directly so behavior stays in
 * sync.
 */
export async function probeCookie(cookie: string): Promise<ProbeOutcome> {
  if (!cookie.trim()) {
    return { ok: false, message: '尚未配置 Cookie。' };
  }
  let res: Response;
  try {
    res = await fetch(PROBE_URL, {
      headers: {
        'user-agent': DESKTOP_UA,
        accept: 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9',
        cookie: cookie.trim(),
      },
      redirect: 'manual',
    });
  } catch (err) {
    return {
      ok: false,
      message: `网络错误：${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const status = res.status;
  if (status === 200) {
    return {
      ok: true,
      status,
      message: 'Cookie 通过基础探测（HTTP 200）。',
    };
  }
  if (status >= 300 && status < 400) {
    return {
      ok: false,
      status,
      message: `iesdouyin 返回重定向（${status}）— 通常意味着 Cookie 已过期。`,
    };
  }
  let bodyPreview = '';
  try {
    bodyPreview = (await res.text()).slice(0, 240);
  } catch {
    /* ignore */
  }
  return {
    ok: false,
    status,
    bodyPreview,
    message: `iesdouyin 返回 HTTP ${status}（可能命中风控或 Cookie 失效）。`,
  };
}

export type ScheduledProbeResult = 'skipped' | 'ok' | 'failed' | 'unconfigured';

// Module-level in-flight tracking. When parallel patrols (Round 120
// makes creators + keywords run concurrently) both invoke the probe
// before the first finishes, the second join the same Promise instead
// of firing a second fetch — prevents duplicate run_history rows on
// failure and double-hits to iesdouyin on cooldown miss.
let inflightProbe: Promise<ScheduledProbeResult> | null = null;

/**
 * Patrol-friendly cookie probe with a 1-hour cooldown so a per-minute
 * automation cron doesn't hammer iesdouyin. Honest contract:
 *   - Returns 'skipped' if the cookie was probed successfully within the
 *     last hour (cookieLastOkAt). Caller can ignore.
 *   - Returns 'unconfigured' if no cookie is set — caller should treat
 *     this like any other non-configured state, not a failure.
 *   - Returns 'ok' or 'failed' otherwise. Failures emit a run_history
 *     row so the user can see the probe is repeatedly bouncing.
 *     Successes write `cookieLastOkAt` via markCookieOk and emit no
 *     run_history (silent success keeps the timeline tidy).
 *
 * Pure side effects: fetch + settings KV + (on failure) one run_history
 * insert. No exceptions thrown — caller can chain safely.
 */
export async function runScheduledCookieProbe(
  now: Date = new Date(),
): Promise<ScheduledProbeResult> {
  // Coalesce concurrent calls so parallel patrol fires only one probe.
  if (inflightProbe) return inflightProbe;
  inflightProbe = (async () => {
    try {
      return await runScheduledCookieProbeImpl(now);
    } finally {
      inflightProbe = null;
    }
  })();
  return inflightProbe;
}

async function runScheduledCookieProbeImpl(now: Date): Promise<ScheduledProbeResult> {
  const settings = getDouyinCollectorSettings();
  if (!settings.cookie.trim()) return 'unconfigured';
  if (settings.cookieLastOkAt) {
    const last = Date.parse(settings.cookieLastOkAt);
    if (Number.isFinite(last) && now.getTime() - last < PROBE_COOLDOWN_MS) {
      return 'skipped';
    }
  }
  const outcome = await probeCookie(settings.cookie);
  if (outcome.ok) {
    markCookieOk(now);
    return 'ok';
  }
  const store = getDouyinCollectorStore();
  store.create(RUN_HISTORY_COLLECTION, {
    title: 'Cookie 自动探测',
    status: 'failed',
    summary: outcome.message,
    failure_reason: outcome.message,
    updated_at: now.toISOString(),
  });
  return 'failed';
}
