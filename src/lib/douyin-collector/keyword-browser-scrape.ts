/**
 * Keyword search scraping via Lumos's embedded BrowserManager.
 *
 * Same architectural reasoning as creator-browser-scrape.ts: as of
 * 2026-05, douyin's search SSR no longer ships videos in
 * RENDER_DATA — the aweme list is fetched client-side via signed APIs
 * and rendered into the DOM after the JS-VM unpacks. A real browser
 * context lets us read that DOM after render.
 *
 * URL strategy:
 *   - https://www.douyin.com/search/<query>?aid=<uuid>&type=general
 * This matches douyin's current desktop search route. It renders
 * `<a href="/video/<aweme_id>">` on some builds, but newer search
 * cards can hide IDs in escaped hydration JSON or React props. We scan
 * anchors, decoded HTML, selected window state and element props.
 *
 * Caller filters by additional metadata after the per-video fetch
 * (we don't try to identify which videos are "really about" the
 * keyword — that's a relevance-ranking problem douyin's own search
 * already solves; we trust the page's order).
 */

import { randomUUID } from 'node:crypto';

import {
  resolveBrowserBridgeRuntimeConfig,
  postToBrowserBridge,
  type BrowserBridgeResponse,
} from '@/lib/browser-runtime/bridge-client';
import {
  closeDouyinScrapePage,
  describeDouyinChallengePage,
  DOUYIN_DOMAIN,
  DOUYIN_SITE_EVALUATE_TIMEOUT_MS,
  focusDouyinScrapePage,
  injectDouyinCookies,
  resolveDouyinBrowserContextIds,
} from './creator-browser-scrape';
import { markCookieOk } from './settings';

/**
 * Identical script shape to creator scrape: collect `/video/<id>` hrefs,
 * skip Baidu spider links, scroll-and-wait if empty up to 4 cycles.
 */
export const KEYWORD_SCRAPE_SCRIPT = `
(async function () {
  try {
    var AWEME_ID_RE = /(?:aweme_id|awemeId|aweme_id_str|awemeIdStr|group_id|groupId|itemId|item_id|item_id_str|video_id|videoId|modal_id|modalId|note_id|noteId)[^0-9]{0,24}(\\d{15,25})/gi;
    var VIDEO_PATH_RE = /(?:\\/video\\/|\\/share\\/video\\/)(\\d{15,25})/gi;
    var VIDEO_QUERY_RE = /[?&#](?:aweme_id|modal_id|item_id|video_id|group_id)=(\\d{15,25})/gi;
    function isLikelyAwemeId(id) {
      var value = String(id || '');
      if (!/^\\d{15,21}$/.test(value)) return false;
      if (/^0+$/.test(value)) return false;
      // Search pages contain millisecond/date stamps such as
      // 2026051117544938858. They pass the length check but are not
      // Douyin aweme IDs, and the share-page fetch later reports a
      // misleading RENDER_DATA error. Drop obvious YYYYMMDD prefixes.
      if (/^20\\d{2}(0[1-9]|1[0-2])([0-2]\\d|3[01])/.test(value)) return false;
      return true;
    }
    function addId(seen, items, id, source, href) {
      var normalized = String(id || '');
      if (!isLikelyAwemeId(normalized) || seen.has(normalized)) return;
      seen.add(normalized);
      items.push({ awemeId: normalized, source: source, href: href || null });
    }
    function normalizeText(text) {
      return String(text || '')
        .replace(/\\\\u002[fF]/g, '/')
        .replace(/\\\\\\//g, '/')
        .replace(/\\\\["']/g, '"')
        .replace(/&quot;|&#34;|&#x22;/gi, '"')
        .replace(/%2F/gi, '/')
        .replace(/%22/gi, '"')
        .replace(/%3A/gi, ':')
        .replace(/%3D/gi, '=')
        .replace(/%26/gi, '&')
        .replace(/&amp;/gi, '&');
    }
    function decodeMaybe(text) {
      try { return decodeURIComponent(String(text || '')); } catch (_) { return ''; }
    }
    function scanText(seen, items, text, source) {
      if (!text) return;
      var raw = String(text);
      var decoded = decodeMaybe(raw);
      var variants = [raw, normalizeText(raw), decoded, normalizeText(decoded)];
      var used = new Set();
      for (var vi = 0; vi < variants.length && items.length < 120; vi++) {
        var value = variants[vi];
        if (!value || used.has(value)) continue;
        used.add(value);
        var m;
        AWEME_ID_RE.lastIndex = 0;
        while ((m = AWEME_ID_RE.exec(value)) && items.length < 120) addId(seen, items, m[1], source);
        VIDEO_PATH_RE.lastIndex = 0;
        while ((m = VIDEO_PATH_RE.exec(value)) && items.length < 120) addId(seen, items, m[1], source);
        VIDEO_QUERY_RE.lastIndex = 0;
        while ((m = VIDEO_QUERY_RE.exec(value)) && items.length < 120) addId(seen, items, m[1], source);
      }
    }
    function safeStringify(value) {
      var seenObjects = [];
      try {
        return JSON.stringify(value, function (key, val) {
          if (typeof val === 'function') return undefined;
          if (!val || typeof val !== 'object') return val;
          if (seenObjects.indexOf(val) >= 0) return undefined;
          if (seenObjects.length > 80) return undefined;
          seenObjects.push(val);
          return val;
        });
      } catch (_) {
        return '';
      }
    }
    function scanElement(seen, items, el) {
      if (!el || items.length >= 120) return;
      try {
        if (el.attributes) {
          for (var ai = 0; ai < el.attributes.length && items.length < 120; ai++) {
            scanText(seen, items, el.attributes[ai].value, 'attr');
          }
        }
        var keys = Object.keys(el);
        for (var ki = 0; ki < keys.length && items.length < 120; ki++) {
          var key = keys[ki];
          if (!/^__react(?:Props|Fiber)\\$/.test(key)) continue;
          var val = el[key];
          scanText(seen, items, safeStringify(val && (val.memoizedProps || val.pendingProps || val)), 'react');
        }
      } catch (_) {}
    }
    function scanWindowState(seen, items) {
      var keys = ['RENDER_DATA', '_ROUTER_DATA', '__NEXT_DATA__', 'SIGI_STATE', 'SSR_DATA'];
      for (var i = 0; i < keys.length && items.length < 120; i++) {
        try { scanText(seen, items, safeStringify(window[keys[i]]), 'window.' + keys[i]); } catch (_) {}
      }
    }
    function collect() {
      var anchors = document.querySelectorAll('a[href]');
      var seen = new Set();
      var items = [];
      for (var i = 0; i < anchors.length; i++) {
        var href = anchors[i].getAttribute('href') || '';
        if (/[?&]source=Baiduspider/i.test(href)) continue;
        var before = items.length;
        scanText(seen, items, href, 'anchor');
        if (items.length > before && !/^https?:/i.test(href)) {
          for (var hi = before; hi < items.length; hi++) {
            items[hi].href = 'https://www.douyin.com' + (href.charAt(0) === '/' ? href : '/' + href);
          }
        }
      }
      var html = document.documentElement ? document.documentElement.outerHTML : '';
      scanText(seen, items, html, 'html');
      scanWindowState(seen, items);
      var nodes = document.querySelectorAll('a[href], [role="link"], [data-e2e], [data-testid], article, section, li, div');
      for (var ni = 0; ni < nodes.length && ni < 1200 && items.length < 120; ni++) {
        scanElement(seen, items, nodes[ni]);
      }
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
      hrefCount: collected.hrefCount,
      htmlLength: collected.htmlLength,
      items: collected.items,
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
})()
`;

export interface BrowserKeywordScrapeOutcome {
  ok: boolean;
  awemeIds?: string[];
  url?: string;
  reason?: string;
}

export function buildKeywordSearchUrl(query: string, aid: string = randomUUID()): string {
  const encodedQuery = encodeURIComponent(query.trim());
  return `https://www.douyin.com/search/${encodedQuery}?aid=${encodeURIComponent(aid)}&type=general`;
}

function isLikelyAwemeIdCandidate(id: string): boolean {
  if (!/^\d{15,21}$/.test(id)) return false;
  if (/^0+$/.test(id)) return false;
  return !/^20\d{2}(0[1-9]|1[0-2])([0-2]\d|3[01])/.test(id);
}

/**
 * Probe the embedded browser for videos matching a keyword.
 *
 * Douyin currently routes both single-word and multi-word keyword discovery
 * through /search/<q>?type=general. The page needs cookie auth — anonymous
 * visits just see SEO bait. Caller surfaces actionable error when cookie
 * isn't configured.
 */
export async function fetchKeywordAwemesViaBrowser(
  query: string,
): Promise<BrowserKeywordScrapeOutcome> {
  if (process.env.JEST_WORKER_ID || process.env.NODE_ENV === 'test') {
    return { ok: false, reason: '测试环境短路。' };
  }

  const trimmed = query.trim();
  if (!trimmed) return { ok: false, reason: 'keyword 为空。' };

  const failures: string[] = [];
  for (const browserContextId of resolveDouyinBrowserContextIds()) {
    const outcome = await fetchKeywordAwemesViaBrowserContext(trimmed, browserContextId);
    if (outcome.ok && outcome.awemeIds && outcome.awemeIds.length > 0) return outcome;
    if (outcome.reason) failures.push(`${browserContextId}: ${outcome.reason}`);
  }
  return {
    ok: false,
    reason: failures.length > 0
      ? failures.join('；')
      : '所有可用浏览器上下文都没有抓到关键词视频列表。',
  };
}

async function fetchKeywordAwemesViaBrowserContext(
  query: string,
  browserContextId: string,
): Promise<BrowserKeywordScrapeOutcome> {
  const config = resolveBrowserBridgeRuntimeConfig({
    browserContextId,
    lockOwnerId: 'douyin-collector',
  });
  if (!config) {
    return { ok: false, reason: '浏览器 bridge 未就绪（仅 Electron 启动后可用）。' };
  }

  const cookieInject = await injectDouyinCookies(config);
  if (!cookieInject.ok) {
    return { ok: false, reason: cookieInject.reason ?? '注入 cookie 失败' };
  }

  const navigateTo = buildKeywordSearchUrl(query);

  interface EvalResp extends BrowserBridgeResponse {
    value?: unknown;
    url?: string;
    pageId?: string;
  }
  let resp: EvalResp | null = null;
  let keepPageOpen = false;
  try {
    resp = await postToBrowserBridge<EvalResp>(config, '/v1/site-pages/evaluate', {
      domain: DOUYIN_DOMAIN,
      script: KEYWORD_SCRAPE_SCRIPT,
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
      return { ok: false, reason: `内置浏览器返回失败：${resp.error ?? 'unknown'}` };
    }

    const value = resp.value as
      | {
          ok?: boolean;
          items?: Array<{ awemeId?: string }>;
          error?: string;
          challenge?: boolean;
          title?: string;
          hrefCount?: number;
          htmlLength?: number;
        }
      | null
      | undefined;
    if (!value || value.ok === false) {
      return { ok: false, reason: `脚本执行错误：${value?.error ?? 'no value returned'}` };
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

    const awemeIds = Array.from(new Set((value.items ?? [])
      .map((it) => (typeof it.awemeId === 'string' ? it.awemeId : null))
      .filter((id): id is string => !!id && isLikelyAwemeIdCandidate(id))));
    if (awemeIds.length === 0) {
      return {
        ok: false,
        url: resp.url,
        reason: `页面已打开但未出现视频 ID（title: ${value.title || 'unknown'}，href ${value.hrefCount ?? 0}，html ${value.htmlLength ?? 0}）。`,
      };
    }

    // Round 173: same cookie-OK stamp as creator path. A real feed
    // surfacing on search means cookie unlocks www.douyin.com — that's
    // the strongest validity signal we have.
    if (awemeIds.length > 0) markCookieOk();

    return { ok: true, awemeIds, url: resp.url };
  } finally {
    if (!keepPageOpen) {
      await closeDouyinScrapePage(config, resp.pageId);
    }
  }
}
