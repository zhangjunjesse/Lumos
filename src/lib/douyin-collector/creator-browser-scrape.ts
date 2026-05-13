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
 *   2. POST /v1/site-pages/evaluate with a DOM scraper script that
 *      collects /video/<aweme_id> hrefs from the user page.
 *   3. Caller iterates the awemeIds and calls fetchVideoMetadata to get
 *      full metadata (title / cover / play_addr) — that path already
 *      works (Round 160 fixed mobile UA + _ROUTER_DATA).
 *
 * CLAUDE.md compliance: the bridge's site-pages/evaluate keeps the tab
 * background-only (waitForPageStable uses background:true internally).
 * We close the returned pageId after each scrape and keep cookies/profile
 * state untouched.
 */

import {
  resolveBrowserBridgeRuntimeConfig,
  postToBrowserBridge,
  type BrowserBridgeResponse,
  type BrowserBridgeRuntimeConfig,
} from '@/lib/browser-runtime/bridge-client';
import { EMBEDDED_BROWSER_CONTEXT_ID, normalizeBrowserContextId } from '@/lib/browser-provider/labels';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDouyinCollectorSettings, markCookieOk } from './settings';

// Exported so keyword-browser-scrape can share the bridge config.
export const BRIDGE_CONTEXT_ID = EMBEDDED_BROWSER_CONTEXT_ID;
export const DOUYIN_DOMAIN = 'www.douyin.com';
export const DOUYIN_SITE_EVALUATE_TIMEOUT_MS = 90_000;
const DOUYIN_PAGE_CLOSE_TIMEOUT_MS = 10_000;

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

interface RuntimeBrowserProviderConfig {
  id?: string;
  providerType?: string;
  enabled?: boolean;
  profileId?: string;
}

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

function getConfiguredDataDir(): string {
  return process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
}

function readRuntimePreferredBrowserContextId(): string | null {
  if (process.env.JEST_WORKER_ID && !process.env.LUMOS_DATA_DIR && !process.env.CLAUDE_GUI_DATA_DIR) {
    return null;
  }
  try {
    const file = path.join(getConfiguredDataDir(), 'runtime', 'browser-providers.json');
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as { configs?: RuntimeBrowserProviderConfig[] };
    const config = parsed.configs?.find((item) => item.enabled !== false && item.providerType === 'adspower' && item.profileId?.trim())
      ?? parsed.configs?.find((item) => item.enabled !== false && item.providerType === 'external-cdp' && item.id?.trim());
    if (!config) return null;
    if (config.providerType === 'adspower' && config.profileId?.trim()) {
      return `adspower:${config.profileId.trim()}`;
    }
    if (config.providerType === 'external-cdp' && config.id?.trim()) {
      return `external-cdp:${config.id.trim()}`;
    }
    return null;
  } catch {
    return null;
  }
}

export function resolveDouyinBrowserContextIds(): string[] {
  const preferred = readRuntimePreferredBrowserContextId();
  const ids = [
    preferred ? normalizeBrowserContextId(preferred) : null,
    EMBEDDED_BROWSER_CONTEXT_ID,
  ].filter((id): id is string => Boolean(id));
  return Array.from(new Set(ids));
}

/**
 * Wait + scroll cycle: anonymous douyin user pages render an SEO-bait
 * skeleton first, then the real creator feed only after client JS
 * decodes the JS-VM and fetches data. Empirically 6-8s + a few scroll
 * cycles is enough to populate the actual aweme list. If not even one
 * `?source=Baiduspider`-free aweme link shows up after the wait, we
 * report "feed empty" honestly so the caller can suggest cookie auth.
 */
const SCRAPE_SCRIPT = `
(async function () {
  try {
    var AWEME_ID_RE = /(?:aweme_id|awemeId|group_id|itemId|item_id|awemeIdStr)["'\\s:=]+["']?(\\d{15,25})/g;
    var VIDEO_PATH_RE = /\\/video\\/(\\d{15,25})/g;
    function addId(seen, items, id, source, href) {
      if (!id || seen.has(id)) return;
      seen.add(id);
      items.push({ awemeId: id, source: source, href: href || null });
    }
    function scanText(seen, items, text, source) {
      if (!text) return;
      var m;
      AWEME_ID_RE.lastIndex = 0;
      while ((m = AWEME_ID_RE.exec(text)) && items.length < 120) addId(seen, items, m[1], source);
      VIDEO_PATH_RE.lastIndex = 0;
      while ((m = VIDEO_PATH_RE.exec(text)) && items.length < 120) addId(seen, items, m[1], source);
    }
    function collect() {
      var anchors = document.querySelectorAll('a[href]');
      var seen = new Set();
      var items = [];
      for (var i = 0; i < anchors.length; i++) {
        var href = anchors[i].getAttribute('href') || '';
        var m = href.match(/\\/video\\/(\\d{15,25})/);
        if (!m) continue;
        var aid = m[1];
        if (seen.has(aid)) continue;
        // Skip Baidu/spider SEO links — they're recommendations from
        // OTHER creators, not this user's feed.
        if (/[?&]source=Baiduspider/i.test(href)) continue;
        addId(seen, items, aid, 'anchor', href.startsWith('http') ? href : ('https://www.douyin.com' + href));
      }
      var html = document.documentElement ? document.documentElement.outerHTML : '';
      scanText(seen, items, html, 'html');
      return {
        items: items,
        hrefCount: anchors.length,
        htmlLength: html.length,
      };
    }
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function isChallengePage() {
      var text = ((document.body && document.body.innerText) || '').slice(0, 3000);
      return /验证码|安全验证|captcha|verify|滑块|拖动|验证中间页/i.test((document.title || '') + ' ' + location.href + ' ' + text);
    }

    var collected = collect();
    // Up to 4 scroll-and-wait cycles. Each cycle: scroll to bottom +
    // wait ~3s for any lazy-rendered videos to commit to DOM. Stop
    // early once we have ≥1 non-spider aweme — typical creator feeds
    // load batches of 12-30 at a time so even one is a strong signal.
    for (var attempt = 0; attempt < 6 && collected.items.length === 0; attempt++) {
      await sleep(3000);
      try { window.scrollTo(0, document.body.scrollHeight); } catch (_) {}
      collected = collect();
    }
    return {
      ok: true,
      title: document.title || '',
      url: location.href,
      challenge: isChallengePage(),
      attemptsUsed: collected.items.length === 0 ? 6 : undefined,
      hrefCount: collected.hrefCount,
      htmlLength: collected.htmlLength,
      items: collected.items,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
})()
`;

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
): Promise<BrowserCreatorScrapeOutcome> {
  // Short-circuit in jest workers — even when the host machine has a
  // live ~/.lumos/runtime/browser-bridge.json from a running Electron,
  // tests must not hit it (would consume mock fetch responses meant
  // for the legacy fetch path).
  if (process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test') {
    return { ok: false, reason: '测试环境短路。' };
  }
  const failures: string[] = [];
  for (const browserContextId of resolveDouyinBrowserContextIds()) {
    const outcome = await fetchCreatorAwemesViaBrowserContext(secUid, browserContextId);
    if (outcome.ok && outcome.awemeIds && outcome.awemeIds.length > 0) {
      return outcome;
    }
    if (outcome.reason) failures.push(`${browserContextId}: ${outcome.reason}`);
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

  let resp: EvalResp | null = null;
  try {
    resp = await postToBrowserBridge<EvalResp>(config, '/v1/site-pages/evaluate', {
      domain: DOUYIN_DOMAIN,
      script: SCRAPE_SCRIPT,
      initialUrl: 'https://www.douyin.com/',
      navigateTo,
    }, { timeoutMs: DOUYIN_SITE_EVALUATE_TIMEOUT_MS });
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
      return {
        ok: false,
        url: resp.url,
        reason: `浏览器打开的是验证码 / 安全验证页（title: ${value.title || 'unknown'}），需要换用已登录且能正常打开抖音的指纹浏览器，或先在该浏览器里人工通过验证。`,
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
    await closeDouyinScrapePage(config, resp.pageId);
  }
}
