/**
 * Goofish item search via Lumos's BrowserManager (the same internal browser
 * DeepSearch uses for Zhihu / Xiaohongshu).
 *
 * Why not use goofish-cli's `search_items`: that tool spawns an EXTERNAL
 * Playwright Chrome window in headful mode — disruptive to the user. Lumos
 * has its own background-mode browser; the AI shouldn't see surprise
 * windows.
 *
 * Flow:
 *   1. Read the active account's cookies.json.
 *   2. POST /v1/cookies/import to inject them into the embedded browser
 *      session for *.goofish.com / *.taobao.com.
 *   3. POST /v1/site-pages/evaluate to navigate a hidden persistent tab to
 *      the search URL and run a DOM scraper. The tab is reused across calls
 *      so subsequent searches are fast.
 */

import { readFileSync } from 'node:fs';

import { resolveBrowserBridgeRuntimeConfig, postToBrowserBridge, type BrowserBridgeResponse } from '@/lib/browser-runtime/bridge-client';
import { cookiesPathFor } from './accounts';

const BRIDGE_CONTEXT_ID = 'embedded:default';
const GOOFISH_DOMAIN = 'goofish.com';
const TAOBAO_COOKIE_NAMES = new Set(['_m_h5_tk', '_m_h5_tk_enc', 'x5sec', 'sgcookie', 'cookie2', '_tb_token_']);

export interface GoofishSearchItem {
  itemId: string;
  url: string;
  title: string;
  price: string;
  mainPic: string;
  sellerNick?: string;
  location?: string;
}

export interface GoofishSearchResult {
  items: GoofishSearchItem[];
  sourceUrl: string;
  truncatedHtml?: string;
  bodyLen?: number;
  /** When DOM didn't yield items — for diagnostics. */
  fallbackUsed?: boolean;
  /** True if 闲鱼 returned a risk-control / "非法访问" page. */
  blocked?: boolean;
  blockReason?: string;
}

/**
 * Run a goofish item search. Returns up to `limit` results.
 * `accountUnb` selects which account's cookies to inject. If omitted, no
 * cookies are injected (search may degrade to anonymous results).
 */
export async function searchGoofishItems(
  keyword: string,
  opts: { accountUnb?: string; limit?: number } = {},
): Promise<GoofishSearchResult> {
  const config = resolveBrowserBridgeRuntimeConfig({ browserContextId: BRIDGE_CONTEXT_ID });
  if (!config) throw new Error('browser bridge not available');
  const limit = Math.max(1, Math.min(50, opts.limit ?? 30));

  if (opts.accountUnb) {
    await injectAccountCookies(config, opts.accountUnb);
  }

  const sourceUrl = `https://www.goofish.com/search?q=${encodeURIComponent(keyword)}`;

  interface EvalResp extends BrowserBridgeResponse { value?: unknown; url?: string; pageId?: string }
  const resp = await postToBrowserBridge<EvalResp>(config, '/v1/site-pages/evaluate', {
    domain: GOOFISH_DOMAIN,
    script: SCRAPE_SCRIPT,
    initialUrl: 'https://www.goofish.com/',
    navigateTo: sourceUrl,
  });

  const payload = (resp.value as {
    items?: GoofishSearchItem[];
    bodyLen?: number;
    fallbackUsed?: boolean;
    blocked?: boolean;
    blockReason?: string;
  } | null) || {};
  const items = (payload.items || []).slice(0, limit);
  return {
    items,
    sourceUrl: resp.url || sourceUrl,
    bodyLen: payload.bodyLen,
    fallbackUsed: payload.fallbackUsed,
    blocked: payload.blocked,
    blockReason: payload.blockReason,
  };
}

interface BridgeCookie {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
}

/**
 * Read the per-account cookies.json (chrome-export array OR plain dict),
 * convert each cookie to the bridge's expected format, and POST them to
 * /v1/cookies/import. Goofish session signing relies on cookies for both
 * `.goofish.com` and `.taobao.com`, so we domain-route accordingly.
 */
async function injectAccountCookies(
  config: NonNullable<ReturnType<typeof resolveBrowserBridgeRuntimeConfig>>,
  accountUnb: string,
): Promise<void> {
  const cookiesPath = cookiesPathFor(accountUnb);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(cookiesPath, 'utf-8'));
  } catch (err) {
    throw new Error(`failed to read cookies for account ${accountUnb}: ${(err as Error).message}`);
  }

  const bridgeCookies: BridgeCookie[] = [];
  const expires = Math.floor(Date.now() / 1000) + 7 * 86400;

  if (Array.isArray(raw)) {
    // chrome-export format: [{ name, value, domain, path, ... }, ...]
    for (const c of raw) {
      const r = c as Record<string, unknown>;
      const name = String(r.name || '');
      const value = String(r.value || '');
      if (!name) continue;
      const domain = String(r.domain || guessDomain(name));
      bridgeCookies.push({
        url: domainToUrl(domain),
        name,
        value,
        domain,
        path: String(r.path || '/'),
        secure: r.secure === true,
        httpOnly: r.httpOnly === true,
        expirationDate: typeof r.expires === 'number' ? r.expires : expires,
      });
    }
  } else if (raw && typeof raw === 'object') {
    // plain dict { name: value }
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!name || typeof value !== 'string') continue;
      const domain = guessDomain(name);
      bridgeCookies.push({
        url: domainToUrl(domain),
        name,
        value,
        domain,
        path: '/',
        secure: true,
        expirationDate: expires,
      });
    }
  }

  if (bridgeCookies.length === 0) return;
  // First try a bulk import — fast path. If it fails (e.g. one of the
  // cookies hits an HttpOnly conflict in the existing session), fall back
  // to importing one-at-a-time so a single bad entry doesn't drop them all.
  try {
    await postToBrowserBridge(config, '/v1/cookies/import', { cookies: bridgeCookies });
    return;
  } catch (err) {
    console.warn('[goofish-browser-search] bulk cookie import failed, retrying one-by-one:', (err as Error).message);
  }
  let imported = 0;
  for (const c of bridgeCookies) {
    try {
      await postToBrowserBridge(config, '/v1/cookies/import', { cookies: [c] });
      imported++;
    } catch (err) {
      // Common cause: same cookie name already exists with different
      // HttpOnly flag. Skip it — partial cookies usually still authenticate.
      console.warn(`[goofish-browser-search] skip ${c.name}: ${(err as Error).message}`);
    }
  }
  console.log(`[goofish-browser-search] imported ${imported}/${bridgeCookies.length} cookies for ${accountUnb}`);
}

function guessDomain(cookieName: string): string {
  return TAOBAO_COOKIE_NAMES.has(cookieName) ? '.taobao.com' : '.goofish.com';
}

function domainToUrl(domain: string): string {
  const host = domain.startsWith('.') ? `www${domain}` : domain;
  return `https://${host}/`;
}

/**
 * DOM scraper run inside the browser. Defensive:
 *   - sleeps long enough for the SPA + lazy-loaded cards to render
 *   - scrolls the page to trigger lazy loading
 *   - detects 闲鱼 anti-bot pages explicitly and surfaces a clear signal
 *   - tries multiple selector variations because card class names rotate
 */
const SCRAPE_SCRIPT = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(2500);
  for (let i = 0; i < 3; i++) { window.scrollBy(0, 800); await sleep(600); }
  await sleep(500);

  const text = document.body.innerText || '';
  const blockSignals = ['非法访问', '请使用正常浏览器', '小二', '滑动验证', '安全验证'];
  const blocked = blockSignals.find((s) => text.includes(s));
  if (blocked) {
    return { items: [], blocked: true, blockReason: blocked, url: location.href, bodyLen: text.length };
  }

  // Strategy: find the SMALLEST containers each holding exactly ONE item link.
  // The previous "walk up 6 levels" approach landed on grandparent containers
  // that wrapped multiple cards, so all results inherited the same metadata.
  //
  // Step 1: collect all valid item anchors (must be goofish item URLs, not
  //         user / share / spm links that may also contain "id=").
  // Step 2: for each, walk up just until the ancestor doesn't contain
  //         OTHER item anchors. That ancestor is this item's card.
  function isItemAnchor(a) {
    const href = a.href || '';
    if (!/goofish\\.com\\/item/i.test(href) && !/[?&]id=\\d+/.test(href)) return false;
    if (/personal|user|seller|share|community/i.test(href)) return false;
    return true;
  }
  function extractItemId(href) {
    const m = href.match(/[?&]id=(\\d+)/) || href.match(/\\/item\\/(\\d+)/);
    return m ? m[1] : '';
  }
  const allAnchors = Array.from(document.querySelectorAll('a[href]')).filter(isItemAnchor);

  const cardForAnchor = (anchor) => {
    let node = anchor;
    let last = anchor;
    for (let i = 0; i < 8 && node.parentElement; i++) {
      node = node.parentElement;
      // Count how many distinct item anchors are inside this node.
      const insideAnchors = node.querySelectorAll('a[href]');
      const insideItems = new Set();
      for (const x of insideAnchors) {
        if (!isItemAnchor(x)) continue;
        const id = extractItemId(x.href);
        if (id) insideItems.add(id);
      }
      if (insideItems.size > 1) return last;  // ancestor wraps multiple — use prior
      last = node;
    }
    return last;
  };

  const items = [];
  const seen = new Set();
  for (const a of allAnchors) {
    const itemId = extractItemId(a.href);
    if (!itemId || seen.has(itemId)) continue;
    seen.add(itemId);
    const card = cardForAnchor(a);
    const txt = (el) => (el?.textContent || '').replace(/\\s+/g, ' ').trim();
    // Title: longest non-price text in the card, fallback to anchor text.
    const titleEl = card.querySelector('[class*="title" i], h3, h4');
    let title = txt(titleEl);
    if (!title) {
      const allText = txt(card);
      title = allText.split(/[¥￥]/)[0].trim();
    }
    title = title.slice(0, 140);
    // Price: text starting with ¥ or ￥, take first match.
    const priceMatch = txt(card).match(/[¥￥]\\s*[\\d,.]+/);
    const price = priceMatch ? priceMatch[0].slice(0, 40) : '';
    // Seller / location: regexes since class names rotate.
    const cardText = txt(card);
    const locMatch = cardText.match(/[\\u4e00-\\u9fa5]{2,4}(?=\\s|$)/);
    const img = card.querySelector('img');
    items.push({
      itemId,
      url: a.href,
      title,
      price,
      mainPic: img?.src || '',
      sellerNick: '',
      location: locMatch ? locMatch[0] : '',
    });
    if (items.length >= 50) break;
  }
  return {
    items,
    blocked: false,
    bodyLen: text.length,
    htmlLen: document.documentElement.innerHTML.length,
    url: location.href,
    fallbackUsed: items.length === 0,
  };
})()`;
