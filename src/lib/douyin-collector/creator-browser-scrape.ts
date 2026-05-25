/**
 * Creator-page scraping via Lumos's embedded BrowserManager.
 *
 * Why this exists: as of 2026-05, douyin's anti-bot wraps
 * iesdouyin/share/user/* in a `_$jsvmprt` JavaScript-VM blob that no
 * fetch-only path can decode. A real browser context (Lumos's
 * BrowserManager already used by DeepSearch / Goofish) lets the JS-VM
 * unpack itself and exposes the rendered DOM where video links live.
 *
 * Flow:
 *   1. Read browser-bridge runtime config (~/.lumos/runtime/browser-bridge.json).
 *   2. Evaluate a DOM scraper script that collects real
 *      /video/<aweme_id> anchors from the user page. External profiles
 *      such as AdsPower run in a visible foreground tab because douyin
 *      often withholds the creator feed from background/offscreen pages.
 *   3. Caller iterates the awemeIds and calls fetchVideoMetadata to get
 *      full metadata (title / cover / play_addr) — that path already
 *      works (Round 160 fixed mobile UA + _ROUTER_DATA).
 *
 * We close the returned pageId after each scrape and keep cookies/profile
 * state untouched, except challenge pages which stay open so the user can
 * pass manual verification.
 */

import {
  resolveBrowserBridgeRuntimeConfig,
  getFromBrowserBridge,
  postToBrowserBridge,
  type BrowserBridgeResponse,
  type BrowserBridgeRuntimeConfig,
} from '@/lib/browser-runtime/bridge-client';
import { EMBEDDED_BROWSER_CONTEXT_ID, normalizeBrowserContextId } from '@/lib/browser-provider/labels';
import { getDouyinCollectorSettings, markCookieOk } from './settings';

// Exported so keyword-browser-scrape can share the bridge config.
export const BRIDGE_CONTEXT_ID = EMBEDDED_BROWSER_CONTEXT_ID;
export const DOUYIN_DOMAIN = 'www.douyin.com';
// Full-mode creator scrape 要长滚: 130+ 条视频博主，每滚一下抖音 lazy
// load 加几条，30+ 次 scroll 才到底；之前 90s 顶不住——博主多到一半就被
// client 端 timeout 拦截，调用方误判"采到底了"只剩 38 条。240s 给出充足
// 余量，stableRounds 触发提前 break 也不会被截。
export const DOUYIN_SITE_EVALUATE_TIMEOUT_MS = 240_000;
const DOUYIN_PAGE_CLOSE_TIMEOUT_MS = 10_000;
const CREATOR_FOREGROUND_EVALUATE_RETRY_DELAY_MS = 2_500;
const CREATOR_RECENT_MAX_VIDEOS = 80;
const CREATOR_FULL_MAX_VIDEOS = 300;

/**
 * Parse a `name=value; name=value` cookie string into objects the bridge
 * /v1/cookies/import endpoint accepts. Whitespace around `=` is trimmed.
 * Empty / malformed segments are skipped silently — this is best-effort
 * recovery from a user-pasted blob, not a strict parser.
 */
function parseCookieString(raw: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const i = trimmed.indexOf('=');
    if (i < 0) continue;
    const name = trimmed.slice(0, i).trim();
    const value = trimmed.slice(i + 1).trim();
    if (!name) continue;
    out.push({ name, value });
  }
  return out;
}

/**
 * Module-level cache: which cookie blob did we last successfully push
 * to the bridge? If the user's settings.cookie hasn't changed since,
 * skip the round-trip — the bridge persists cookies for the session.
 * Reset on bridge baseUrl change too (different process / restart).
 *
 * Round 170: avoids re-pushing 10+ cookies on every scrape call.
 * Patrol of 5 creators went from 5 × cookie-import to 1 × cookie-import
 * + 5 × evaluate.
 */
let lastCookieKey: { baseUrl: string; browserContextId: string; cookieRaw: string } | null = null;

const DOUYIN_HTTP_ONLY_COOKIE_NAMES = new Set([
  'sessionid',
  'sessionid_ss',
  'sid_tt',
  'sid_guard',
  'uid_tt',
  'uid_tt_ss',
  'passport_assist_user',
  'passport_auth_mix_state',
  'sid_ucp_v1',
  'ssid_ucp_v1',
]);

/**
 * Inject the user's douyin cookie (from Settings → Cookie) into the
 * BrowserManager session for *.douyin.com so subsequent navigations
 * render the logged-in DOM (the actual creator feed, not the
 * SEO-bait skeleton served to anonymous visitors).
 */
export async function injectDouyinCookies(
  config: ReturnType<typeof resolveBrowserBridgeRuntimeConfig>,
): Promise<{ ok: boolean; reason?: string; importedCount?: number; skipped?: boolean }> {
  if (!config) return { ok: false, reason: 'config null' };
  const settings = getDouyinCollectorSettings();
  const cookieRaw = settings.cookie?.trim() ?? '';
  if (!cookieRaw) {
    return {
      ok: false,
      reason: '抖音 Cookie 未配置——「设置 → Cookie」粘贴登录后从抖音 DevTools 复制的 Cookie 字符串。',
    };
  }
  // Skip if we already pushed this exact cookie to this exact bridge.
  if (lastCookieKey
    && lastCookieKey.baseUrl === config.baseUrl
    && lastCookieKey.browserContextId === normalizeBrowserContextId(config.browserContextId)
    && lastCookieKey.cookieRaw === cookieRaw) {
    return { ok: true, skipped: true };
  }
  const parsed = parseCookieString(cookieRaw);
  if (parsed.length === 0) {
    return { ok: false, reason: 'Cookie 字符串解析为空，请检查格式 `name=value; name=value`。' };
  }
  const cookies = parsed.map((c) => ({
    url: 'https://www.douyin.com/',
    name: c.name,
    value: c.value,
    domain: '.douyin.com',
    path: '/',
    secure: true,
    httpOnly: DOUYIN_HTTP_ONLY_COOKIE_NAMES.has(c.name),
  }));
  try {
    const resp = await postToBrowserBridge<BrowserBridgeResponse & { importedCount?: number }>(
      config,
      '/v1/cookies/import',
      { cookies },
    );
    if (!resp.ok) {
      // Don't cache a failed push — next call should retry.
      return { ok: false, reason: `cookies/import 失败：${resp.error ?? 'unknown'}` };
    }
    lastCookieKey = {
      baseUrl: config.baseUrl,
      browserContextId: normalizeBrowserContextId(config.browserContextId),
      cookieRaw,
    };
    return { ok: true, importedCount: resp.importedCount };
  } catch (err) {
    const bulkMessage = err instanceof Error ? err.message : String(err);
    if (/BROWSER_CONTEXT_COOKIES_UNSUPPORTED/i.test(bulkMessage)) {
      // External browser providers such as AdsPower/CDP own their profile
      // cookies. The bridge cannot import cookies into them, but that is not
      // fatal: continue and let the real profile login state decide whether
      // the page can render.
      return { ok: true, skipped: true };
    }
    // Chromium refuses to overwrite an existing HttpOnly cookie with a
    // non-HttpOnly value. A single conflict must not drop the rest of the
    // login state, so fall back to one-by-one import and retry conflicts
    // as HttpOnly.
    let importedCount = 0;
    const skipped: string[] = [];
    for (const cookie of cookies) {
      try {
        const resp = await postToBrowserBridge<BrowserBridgeResponse & { importedCount?: number }>(
          config,
          '/v1/cookies/import',
          { cookies: [cookie] },
        );
        if (resp.ok) {
          importedCount += resp.importedCount ?? 1;
          continue;
        }
      } catch (singleErr) {
        const message = singleErr instanceof Error ? singleErr.message : String(singleErr);
        if (/HttpOnly|EXCLUDE_OVERWRITE_HTTP_ONLY/i.test(message) && cookie.httpOnly !== true) {
          try {
            const resp = await postToBrowserBridge<BrowserBridgeResponse & { importedCount?: number }>(
              config,
              '/v1/cookies/import',
              { cookies: [{ ...cookie, httpOnly: true }] },
            );
            if (resp.ok) {
              importedCount += resp.importedCount ?? 1;
              continue;
            }
          } catch (retryErr) {
            skipped.push(`${cookie.name}: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
            continue;
          }
        }
        skipped.push(`${cookie.name}: ${message}`);
      }
    }
    if (importedCount > 0) {
      lastCookieKey = {
        baseUrl: config.baseUrl,
        browserContextId: normalizeBrowserContextId(config.browserContextId),
        cookieRaw,
      };
      return { ok: true, importedCount };
    }
    return {
      ok: false,
      reason: `cookies/import 异常：${bulkMessage}${
        skipped.length > 0 ? `；逐个导入也失败：${skipped.slice(0, 3).join('；')}` : ''
      }`,
    };
  }
}

/**
 * Test-only: clear the cookie-injection cache so subsequent calls
 * re-push. Exported for jest tests that exercise the inject flow.
 */
export function _resetInjectCacheForTests(): void {
  lastCookieKey = null;
}

export async function closeDouyinScrapePage(
  config: BrowserBridgeRuntimeConfig | null | undefined,
  pageId: string | null | undefined,
): Promise<void> {
  const normalizedPageId = typeof pageId === 'string' ? pageId.trim() : '';
  if (!config || !normalizedPageId) return;
  await postToBrowserBridge<BrowserBridgeResponse>(
    config,
    '/v1/pages/close',
    { pageId: normalizedPageId },
    { timeoutMs: DOUYIN_PAGE_CLOSE_TIMEOUT_MS },
  ).catch(() => undefined);
}

export async function focusDouyinScrapePage(
  config: BrowserBridgeRuntimeConfig | null | undefined,
  pageId: string | null | undefined,
): Promise<boolean> {
  const normalizedPageId = typeof pageId === 'string' ? pageId.trim() : '';
  if (!config || !normalizedPageId) return false;
  try {
    await postToBrowserBridge<BrowserBridgeResponse>(
      config,
      '/v1/pages/select',
      { pageId: normalizedPageId, background: false },
      { timeoutMs: DOUYIN_PAGE_CLOSE_TIMEOUT_MS },
    );
    return true;
  } catch {
    return false;
  }
}

export function describeDouyinChallengePage(title: string | undefined, focused: boolean): string {
  return `浏览器打开的是验证码 / 安全验证页（title: ${title || 'unknown'}）。${
    focused
      ? '已保留并切到这个采集页；请先在该浏览器里手动完成验证，确认能正常看到抖音内容后，再回到抖音采集器点击「立即采集」。'
      : '已保留这个采集页但切到前台失败；请在当前采集浏览器里手动打开抖音并完成验证，确认能正常看到抖音内容后，再回到抖音采集器点击「立即采集」。'
  }`;
}

/**
 * The single browser context creator/keyword scraping runs in — the
 * user's explicit choice from Settings → 采集浏览器. Returned as a
 * one-element array because callers iterate contexts; there is
 * deliberately NO fallback to a second browser. Silent fallback is what
 * produced the old confusing double-error ("adspower:xxx fetch failed；
 * embedded:default 验证码页"): the code auto-picked an un-launched
 * AdsPower profile, then quietly retried the embedded browser which hit
 * a captcha — neither of which the user had chosen. Now a wrong/down
 * context fails loudly pointing only at itself.
 */
export function resolveDouyinBrowserContextIds(): string[] {
  return [normalizeBrowserContextId(getDouyinCollectorSettings().browserContextId)];
}

/**
 * Wait + scroll cycle: anonymous douyin user pages render an SEO-bait
 * skeleton first, then the real creator feed only after client JS
 * decodes the JS-VM and fetches data. Empirically 6-8s + a few scroll
 * cycles is enough to populate the actual aweme list. If not even one
 * `?source=Baiduspider`-free aweme link shows up after the wait, we
 * report "feed empty" honestly so the caller can suggest cookie auth.
 */
export const CREATOR_SCRAPE_SCRIPT = `
(async function () {
  try {
    var runtimeOptions = (typeof window !== 'undefined' && window.__LUMOS_DOUYIN_CREATOR_SCRAPE_OPTIONS) || {};
    var maxItems = typeof runtimeOptions.maxItems === 'number' && runtimeOptions.maxItems > 0
      ? Math.min(Math.floor(runtimeOptions.maxItems), 500)
      : 80;
    var maxScrollAttempts = typeof runtimeOptions.maxScrollAttempts === 'number' && runtimeOptions.maxScrollAttempts > 0
      ? Math.min(Math.floor(runtimeOptions.maxScrollAttempts), 160)
      : 8;
    var stableRoundsTarget = typeof runtimeOptions.stableRounds === 'number' && runtimeOptions.stableRounds > 0
      ? Math.min(Math.floor(runtimeOptions.stableRounds), 12)
      : 2;
    var waitMs = typeof runtimeOptions.waitMs === 'number' && runtimeOptions.waitMs >= 500
      ? Math.min(Math.floor(runtimeOptions.waitMs), 5000)
      : 3000;
    var VIDEO_PATH_RE = /\\/video\\/(\\d{15,25})/g;
    function addId(seen, items, id, source, href) {
      if (!id || seen.has(id)) return;
      seen.add(id);
      items.push({ awemeId: id, source: source, href: href || null });
    }
    function hrefCandidates(raw) {
      var values = [raw || ''];
      try {
        var decoded = decodeURIComponent(raw || '');
        if (decoded && decoded !== raw) values.push(decoded);
      } catch (_) {}
      return values;
    }
    function collectInto(seen, items) {
      var anchors = document.querySelectorAll('a[href]');
      var added = 0;
      for (var i = 0; i < anchors.length; i++) {
        if (items.length >= maxItems) break;
        var rawHref = anchors[i].getAttribute('href') || '';
        var candidates = hrefCandidates(rawHref);
        for (var j = 0; j < candidates.length; j++) {
          var href = candidates[j];
          var m = href.match(/\\/video\\/(\\d{15,25})/);
          if (!m) continue;
          var aid = m[1];
          if (seen.has(aid)) continue;
          // Skip Baidu/spider SEO links — they're recommendations from
          // OTHER creators, not this user's feed.
          if (/[?&]source=Baiduspider/i.test(href)) continue;
          var before = items.length;
          addId(seen, items, aid, 'anchor', href.startsWith('http') ? href : ('https://www.douyin.com' + href));
          if (items.length > before) added++;
          break;
        }
      }
      var html = document.documentElement ? document.documentElement.outerHTML : '';
      return {
        added: added,
        items: items,
        hrefCount: anchors.length,
        htmlLength: html.length,
      };
    }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function findScrollContainers() {
      // 抖音 user feed 不挂在 document scroll 上,而是某个 inner div 用
      // overflow:scroll 自己管。document.scrollingElement 实际等于 viewport
      // (scrollHeight===clientHeight),所以 window.scrollTo 是 no-op。
      // 枚举所有真正能滚的元素,按 scrollHeight 降序滚——既覆盖 route-scroll
      // 容器,又防止 class 名 hash 化导致选择器失效。
      var out = [];
      try {
        var all = document.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          var s = getComputedStyle(el);
          var oy = s.overflowY;
          if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 50) {
            out.push(el);
          }
        }
        out.sort(function (a, b) { return b.scrollHeight - a.scrollHeight; });
      } catch (_) {}
      return out;
    }
    function scrollFeed() {
      try {
        // 1) 对所有真实滚动容器,滚到底
        var containers = findScrollContainers();
        for (var i = 0; i < containers.length; i++) {
          try { containers[i].scrollTop = containers[i].scrollHeight; } catch (_) {}
        }
        // 2) window scroll 作 fallback (大多数情况 no-op,但便宜)
        var scroller = document.scrollingElement || document.documentElement || document.body;
        var y = Math.max(scroller ? scroller.scrollHeight : 0, document.body ? document.body.scrollHeight : 0);
        try { window.scrollTo(0, y); } catch (_) {}
        if (scroller) { try { scroller.scrollTop = y; } catch (_) {} }
        // 3) wheel event 给抖音的"用户在滚"信号 (anti-bot 可能拿来打分)
        try {
          var primary = containers[0] || document.scrollingElement || document.body;
          if (primary && primary.dispatchEvent) {
            primary.dispatchEvent(new WheelEvent('wheel', { deltaY: 2400, bubbles: true, cancelable: true }));
          }
          window.dispatchEvent(new WheelEvent('wheel', { deltaY: 2400, bubbles: true, cancelable: true }));
        } catch (_) {}
      } catch (_) {}
    }
    function isChallengePage() {
      var text = ((document.body && document.body.innerText) || '').slice(0, 3000);
      return /验证码|安全验证|captcha|verify|滑块|拖动|验证中间页/i.test((document.title || '') + ' ' + location.href + ' ' + text);
    }

    var seen = new Set();
    var items = [];
    var collected = collectInto(seen, items);
    var stableRounds = 0;
    var attemptsUsed = 0;
    // Scroll-and-wait until the creator anchors stop producing new IDs.
    // Do not treat arbitrary aweme-like numbers in hydration HTML as
    // success: douyin placeholder/risk pages can contain stale IDs such
    // as "在抖音记录美好生活20260524" without rendering the creator feed.
    // Keep a process-wide seen set so full mode survives virtualized feeds
    // that remove earlier cards from the DOM while scrolling.
    for (var attempt = 0; attempt < maxScrollAttempts && items.length < maxItems; attempt++) {
      attemptsUsed = attempt + 1;
      scrollFeed();
      await sleep(waitMs);
      var next = collectInto(seen, items);
      if (next.added > 0) {
        collected = next;
        stableRounds = 0;
      } else {
        stableRounds++;
        collected = next;
        if (items.length > 0 && stableRounds >= stableRoundsTarget) break;
      }
    }
    return {
      ok: true,
      title: document.title || '',
      url: location.href,
      challenge: isChallengePage(),
      attemptsUsed: attemptsUsed,
      maxItems: maxItems,
      hrefCount: collected.hrefCount,
      htmlLength: collected.htmlLength,
      items: items,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
})()
`;

export interface CreatorBrowserScrapeOptions {
  mode?: 'recent' | 'full';
  maxVideos?: number;
}

export interface BrowserCreatorScrapeOutcome {
  ok: boolean;
  /** When ok=true: the list of awemeIds visible on the user page. */
  awemeIds?: string[];
  /** Final URL after navigation — useful for diagnostics. */
  url?: string;
  reason?: string;
}

/**
 * Probe the embedded browser for the creator's video list.
 *
 * Returns ok=false (with a structured reason) when the bridge isn't
 * available — caller decides whether to fall back to fetch-only path
 * or surface the error to the user.
 *
 * Honest contract:
 *   - We only return aweme_ids here. Title / cover / duration require a
 *     follow-up fetchVideoMetadata call per id (cheap, cached by douyin).
 *   - The user-page render time is bounded by the bridge's internal
 *     waitForPageStable timeout (12s); see bridge-server.ts.
 *   - No login required for public creator pages.
 */
export async function fetchCreatorAwemesViaBrowser(
  secUid: string,
  options: CreatorBrowserScrapeOptions = {},
): Promise<BrowserCreatorScrapeOutcome> {
  // Short-circuit in jest workers — even when the host machine has a
  // live ~/.lumos/runtime/browser-bridge.json from a running Electron,
  // tests must not hit it (would consume mock fetch responses meant
  // for the legacy fetch path).
  if (process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test') {
    return { ok: false, reason: '测试环境短路。' };
  }
  // Full mode is chunked at this layer so each inner evaluate stays below
  // the 30s CDP timeout: each chunk scrolls 6 times (~21s), and the
  // accumulator merges aweme_ids across chunks until "stableChunks" rounds
  // in a row add zero new ids OR maxVideos is reached OR maxChunks fires.
  // Result: a 130+-video creator that the old single-shot evaluate cut off
  // at 38 now gets ~12 chunks × 6 scrolls = 72 scroll rounds total.
  const mode = options.mode === 'full' ? 'full' : 'recent';
  const maxChunks = mode === 'full' ? 12 : 1;
  const stableChunksTarget = mode === 'full' ? 4 : 1;
  const maxAccumulated = clampPositiveInteger(options.maxVideos, 1, 500)
    ?? (mode === 'full' ? 300 : 80);
  const failures: string[] = [];

  for (const browserContextId of resolveDouyinBrowserContextIds()) {
    const accumulated = new Set<string>();
    let lastUrl: string | undefined;
    let stableChunks = 0;
    let firstFatalFailure: string | null = null;
    let challengeReason: string | null = null;
    for (let chunk = 0; chunk < maxChunks; chunk++) {
      const outcome = await fetchCreatorAwemesViaBrowserContext(
        secUid,
        browserContextId,
        options,
      );
      if (outcome.url) lastUrl = outcome.url;
      if (!outcome.ok) {
        // Challenge pages are sticky — they stay open for the user to clear
        // manually, so bail out early instead of retrying chunks against a
        // captcha-stuck context (every chunk would just CDP-timeout again).
        if (outcome.reason && /验证|captcha|challenge|滑块/i.test(outcome.reason)) {
          challengeReason = outcome.reason;
          break;
        }
        if (accumulated.size === 0) firstFatalFailure = outcome.reason ?? '内置浏览器返回失败';
        break;
      }
      const before = accumulated.size;
      for (const id of outcome.awemeIds ?? []) accumulated.add(id);
      const added = accumulated.size - before;
      if (added > 0) {
        stableChunks = 0;
      } else {
        stableChunks += 1;
        if (stableChunks >= stableChunksTarget) break;
      }
      if (accumulated.size >= maxAccumulated) break;
    }

    if (challengeReason) {
      failures.push(`${browserContextId}: ${challengeReason}`);
      continue;
    }
    if (accumulated.size > 0) {
      return { ok: true, awemeIds: [...accumulated], url: lastUrl };
    }
    if (firstFatalFailure) failures.push(`${browserContextId}: ${firstFatalFailure}`);
  }
  return {
    ok: false,
    reason: failures.length > 0
      ? failures.join('；')
      : '所有可用浏览器上下文都没有抓到视频列表。',
  };
}

async function fetchCreatorAwemesViaBrowserContext(
  secUid: string,
  browserContextId: string,
  options: CreatorBrowserScrapeOptions,
): Promise<BrowserCreatorScrapeOutcome> {
  const config = resolveBrowserBridgeRuntimeConfig({
    browserContextId,
    lockOwnerId: 'douyin-collector',
  });
  if (!config) {
    return { ok: false, reason: '浏览器 bridge 未就绪（仅 Electron 启动后可用）。' };
  }

  // Inject douyin cookies so the page renders the logged-in feed
  // instead of the SEO-bait skeleton anonymous visitors see. Without
  // this, even with proper wait+scroll the actual creator videos
  // never load. If the user hasn't set a cookie, surface a clear
  // pointer to the Settings tab.
  const cookieInject = await injectDouyinCookies(config);
  if (!cookieInject.ok) {
    return { ok: false, reason: cookieInject.reason ?? '注入 cookie 失败' };
  }

  const navigateTo = `https://www.douyin.com/user/${encodeURIComponent(secUid)}`;
  interface EvalResp extends BrowserBridgeResponse {
    value?: unknown;
    url?: string;
    pageId?: string;
  }
  interface NewPageResp extends BrowserBridgeResponse {
    pageId?: string;
  }

  let resp: EvalResp | null = null;
  let keepPageOpen = false;
  let closePageAfterScrape = true;
  try {
    if (shouldUseForegroundCreatorScrape(browserContextId)) {
      const existingPageId = await findExistingCreatorPage(config, secUid);
      if (existingPageId) {
        closePageAfterScrape = false;
        await postToBrowserBridge<BrowserBridgeResponse>(
          config,
          '/v1/pages/select',
          { pageId: existingPageId, background: false },
          { timeoutMs: DOUYIN_PAGE_CLOSE_TIMEOUT_MS },
        ).catch(() => undefined);
        resp = await evaluateCreatorScrapePage(config, existingPageId, options);
      }
      if (!resp) {
        closePageAfterScrape = true;
        const page = await postToBrowserBridge<NewPageResp>(
          config,
          '/v1/pages/new',
          { background: false },
          { timeoutMs: DOUYIN_SITE_EVALUATE_TIMEOUT_MS },
        );
        resp = { ok: page.ok, pageId: page.pageId };
        if (!page.pageId) {
          return { ok: false, reason: '内置浏览器打开前台采集页失败：缺少 pageId。' };
        }
        await postToBrowserBridge<BrowserBridgeResponse>(
          config,
          '/v1/pages/navigate',
          {
            pageId: page.pageId,
            type: 'url',
            url: navigateTo,
            background: false,
          },
          { timeoutMs: DOUYIN_SITE_EVALUATE_TIMEOUT_MS },
        );
        resp = await evaluateCreatorScrapePage(config, page.pageId, options);
      }
    } else {
      resp = await postToBrowserBridge<EvalResp>(config, '/v1/site-pages/evaluate', {
        domain: DOUYIN_DOMAIN,
        script: buildCreatorScrapeExpression(options),
        initialUrl: 'https://www.douyin.com/',
        navigateTo,
      }, { timeoutMs: DOUYIN_SITE_EVALUATE_TIMEOUT_MS });
    }
  } catch (err) {
    return {
      ok: false,
      reason: `内置浏览器 evaluate 调用失败：${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!resp) {
    return { ok: false, reason: '内置浏览器 evaluate 未返回结果。' };
  }

  try {
    if (!resp.ok) {
      return {
        ok: false,
        reason: `内置浏览器返回失败：${resp.error ?? 'unknown'}`,
      };
    }

    const value = resp.value as
      | {
          ok?: boolean;
          items?: Array<{ awemeId?: string }>;
          error?: string;
          challenge?: boolean;
          title?: string;
          url?: string;
          hrefCount?: number;
          htmlLength?: number;
        }
      | null
      | undefined;
    if (!value || value.ok === false) {
      return {
        ok: false,
        reason: `脚本执行错误：${value?.error ?? 'no value returned'}`,
      };
    }
    if (value.challenge) {
      keepPageOpen = true;
      const focused = await focusDouyinScrapePage(config, resp.pageId);
      return {
        ok: false,
        url: resp.url,
        reason: describeDouyinChallengePage(value.title, focused),
      };
    }

    const awemeIds = (value.items ?? [])
      .map((it) => (typeof it.awemeId === 'string' ? it.awemeId : null))
      .filter((id): id is string => !!id);
    if (awemeIds.length === 0) {
      return {
        ok: false,
        url: resp.url,
        reason: `页面已打开但未出现视频 ID（title: ${value.title || 'unknown'}，href ${value.hrefCount ?? 0}，html ${value.htmlLength ?? 0}）。`,
      };
    }

    // Round 173: a non-empty awemeIds list is a stronger cookie signal
    // than the iesdouyin probe — it proves the cookie unlocks the
    // logged-in feed on www.douyin.com (the real surface we care
    // about). Stamp cookieLastOkAt so Hero's "Cookie X 时间前" chip
    // reflects actual end-to-end success, not just an iteminfo ping.
    if (awemeIds.length > 0) markCookieOk();

    return { ok: true, awemeIds, url: resp.url };
  } finally {
    if (!keepPageOpen && closePageAfterScrape) {
      await closeDouyinScrapePage(config, resp.pageId);
    }
  }
}

function shouldUseForegroundCreatorScrape(browserContextId: string): boolean {
  return /^(adspower|external-cdp):/i.test(normalizeBrowserContextId(browserContextId));
}

async function findExistingCreatorPage(
  config: BrowserBridgeRuntimeConfig,
  secUid: string,
): Promise<string | null> {
  try {
    const resp = await getFromBrowserBridge<BrowserBridgeResponse & {
      pages?: Array<{
        pageId?: string;
        url?: string;
        title?: string;
        isActive?: boolean;
      }>;
    }>(config, '/v1/pages', { timeoutMs: 15_000 });
    const expectedPath = `/user/${secUid}`;
    const candidates = (resp.pages ?? [])
      .filter((page) => {
        if (!page.pageId || !page.url) return false;
        const decodedUrl = safeDecode(page.url);
        if (!decodedUrl.includes(DOUYIN_DOMAIN) || !decodedUrl.includes(expectedPath)) return false;
        return !isDouyinChallengeTitle(page.title);
      })
      .sort((a, b) => Number(b.isActive === true) - Number(a.isActive === true));
    return candidates[0]?.pageId ?? null;
  } catch {
    return null;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isDouyinChallengeTitle(title: string | null | undefined): boolean {
  return /验证码|安全验证|captcha|verify|滑块|拖动|验证中间页/i.test(title || '');
}

async function evaluateCreatorScrapePage(
  config: BrowserBridgeRuntimeConfig,
  pageId: string,
  options: CreatorBrowserScrapeOptions,
): Promise<BrowserBridgeResponse & { value?: unknown; pageId?: string }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await delay(CREATOR_FOREGROUND_EVALUATE_RETRY_DELAY_MS);
      await postToBrowserBridge<BrowserBridgeResponse>(
        config,
        '/v1/pages/select',
        { pageId, background: false },
        { timeoutMs: DOUYIN_PAGE_CLOSE_TIMEOUT_MS },
      ).catch(() => undefined);
    }
    try {
      return await postToBrowserBridge<BrowserBridgeResponse & { value?: unknown; pageId?: string }>(
        config,
        '/v1/pages/evaluate',
        {
          pageId,
          expression: buildCreatorScrapeExpression(options),
          background: false,
        },
        { timeoutMs: DOUYIN_SITE_EVALUATE_TIMEOUT_MS },
      );
    } catch (err) {
      lastError = err;
      if (!isTransientForegroundEvaluateError(err)) throw err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isTransientForegroundEvaluateError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Execution context was destroyed|Inspected target navigated or closed|Cannot find context|Target closed/i.test(message);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildCreatorScrapeExpression(options: CreatorBrowserScrapeOptions): string {
  const mode = options.mode === 'full' ? 'full' : 'recent';
  const fallbackMaxItems = mode === 'full' ? CREATOR_FULL_MAX_VIDEOS : CREATOR_RECENT_MAX_VIDEOS;
  const maxItems = clampPositiveInteger(options.maxVideos, 1, 500) ?? fallbackMaxItems;
  // Inner evaluate must stay < 28s (CDP command default timeout is 30s,
  // hard-coded in electron/browser-provider/external-cdp-provider.ts and
  // not changeable without restarting Electron main). full-mode is now
  // chunked at the caller (fetchCreatorAwemesViaBrowser): each chunk = 6
  // scrolls × 3.5s ≈ 21s, repeated until accumulator-level stableRounds
  // gives 抖音 lazy-load enough breathing room without single-evaluate
  // exceeding CDP timeout. stableRounds inside the chunk stays small
  // because the outer loop owns the "really done" judgment.
  const payload = {
    maxItems,
    maxScrollAttempts: mode === 'full' ? 6 : 12,
    stableRounds: mode === 'full' ? 3 : 3,
    waitMs: mode === 'full' ? 3500 : 2200,
  };
  return `
(function () {
  window.__LUMOS_DOUYIN_CREATOR_SCRAPE_OPTIONS = ${JSON.stringify(payload)};
  return (${CREATOR_SCRAPE_SCRIPT.trim()});
})()
`;
}

function clampPositiveInteger(
  value: number | undefined,
  min: number,
  max: number,
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
