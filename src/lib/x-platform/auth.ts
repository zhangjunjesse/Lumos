/**
 * X 登录态:
 *   1. 内置浏览器手动登录 — X 反爬常常挡 Electron Chromium,实战不可靠,留入口
 *   2. 粘贴 Cookie 字符串(从已登录的系统浏览器 DevTools 复制)— 主路径
 *
 * 真正的 read 操作走 ./scraper.ts 单例(@the-convocation/twitter-scraper)。
 */

import {
  checkBrowserBridgeReady,
  getFromBrowserBridge,
  postToBrowserBridge,
  resolveBrowserBridgeRuntimeConfig,
  type BrowserBridgeResponse,
  type BrowserBridgeRuntimeConfig,
} from '@/lib/browser-runtime/bridge-client';

import {
  clearCookies,
  hasRequiredCookies,
  readCookies,
  userIdFromCookies,
  writeCookies,
} from './cookies-store';
import { XAuthExpiredError } from './auth-error';
import { ensureScraper, resetScraperCache } from './scraper';
import { setXMcpEnabled } from './mcp-toggle';
import type { XAuthStatus } from './types';

const BRIDGE_CONTEXT_ID = 'embedded:default';
const BRIDGE_OWNER_ID = 'x-platform-login';
const X_LOGIN_URL = 'https://x.com/i/flow/login';
const X_HOME_URL = 'https://x.com/home';
const X_COOKIE_CAPTURE_URLS = ['https://x.com/', 'https://twitter.com/'] as const;

const X_COOKIE_NAMES = new Set([
  'auth_token', 'ct0', 'twid', 'guest_id', 'kdt', 'auth_multi',
  'guest_id_marketing', 'guest_id_ads', 'personalization_id',
]);

interface BridgeCookieWithValue { name?: string; value?: string; domain?: string; }
interface BridgeCookiesResponse extends BrowserBridgeResponse { cookies?: BridgeCookieWithValue[]; }
interface BridgeNewPageResponse extends BrowserBridgeResponse { pageId?: string; }

export class XBrowserUnavailableError extends Error {}

function resolveBridgeConfig(): BrowserBridgeRuntimeConfig | null {
  return resolveBrowserBridgeRuntimeConfig({
    browserContextId: BRIDGE_CONTEXT_ID,
    lockOwnerId: BRIDGE_OWNER_ID,
  });
}

export function isBuiltinBrowserAvailable(): boolean {
  return resolveBridgeConfig() !== null;
}

export interface StartLoginOptions { timeoutSecs?: number; }

export async function loginViaBuiltinBrowser(opts: StartLoginOptions = {}): Promise<XAuthStatus> {
  const config = resolveBridgeConfig();
  if (!config) throw new XBrowserUnavailableError('Lumos 内置浏览器不可用,无法登录 X');
  const timeoutSecs = Math.max(60, Math.min(900, opts.timeoutSecs ?? 300));

  const health = await checkBrowserBridgeReady(config);
  if (!health.ready) console.warn('[x-auth] browser bridge not ready:', health.status);

  let pageId = '';
  try {
    const created = await postToBrowserBridge<BridgeNewPageResponse>(
      config, '/v1/pages/new', { url: X_LOGIN_URL, background: false }, { timeoutMs: 60_000 },
    );
    pageId = typeof created.pageId === 'string' ? created.pageId : '';

    const cookies = await waitForLoginCookies(config, timeoutSecs);
    writeCookies(cookies);
    resetScraperCache();
    // 登录成功 → 启用 x-platform MCP,让对话里能用 x_search / x_my_mentions 等工具。
    setXMcpEnabled(true);
    // Mirror the cookie-string login path: push the new cookie set to
    // DeepSearch right away. The lazy reconcile-on-next-getAuthStatus path
    // bails when `deepSearchReconciled` is already true (e.g. a previous
    // account was logged in this process), which would leave DeepSearch
    // stuck on the old account's cookies. Direct sync here avoids that.
    const raw = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (raw) {
      await syncToDeepSearch(raw);
    }
  } finally {
    if (pageId) {
      await postToBrowserBridge(config, '/v1/pages/close', { pageId }, { timeoutMs: 15_000 }).catch(() => undefined);
    }
  }
  return await getAuthStatus({ refreshFromGraphQL: true });
}

async function waitForLoginCookies(
  config: BrowserBridgeRuntimeConfig, timeoutSecs: number,
): Promise<Record<string, string>> {
  const deadline = Date.now() + timeoutSecs * 1000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const cookies = await collectCookiesFromBridge(config);
    if (hasRequiredCookies(cookies)) {
      await sleep(2000);
      const finalCookies = await collectCookiesFromBridge(config);
      if (hasRequiredCookies(finalCookies)) return finalCookies;
    }
  }
  throw new XAuthExpiredError('登录超时或未完成,请重试');
}

async function collectCookiesFromBridge(
  config: BrowserBridgeRuntimeConfig,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const url of X_COOKIE_CAPTURE_URLS) {
    const response = await getFromBrowserBridge<BridgeCookiesResponse>(
      config, `/v1/cookies?url=${encodeURIComponent(url)}&includeValues=1`, { timeoutMs: 15_000 },
    );
    for (const cookie of response.cookies ?? []) {
      if (!cookie?.name || typeof cookie.value !== 'string' || !cookie.value) continue;
      if (!X_COOKIE_NAMES.has(cookie.name)) continue;
      const isXDomain = (cookie.domain || '').replace(/^\./, '').toLowerCase().endsWith('x.com');
      if (!(cookie.name in out) || isXDomain) out[cookie.name] = cookie.value;
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize a single pasted cookie value.
 *
 * Cross-device pastes (DevTools → Application → Cookies, browser cookie
 * exporters, "copy cell" from other tools) frequently wrap the value in
 * quotes or leave a trailing separator: `ct0="abc..."`, `twid='u=...'`,
 * `auth_token=...;`. Stored verbatim, the quotes/comma end up inside the
 * Cookie/x-csrf-token header and X rejects the request with 403 even though
 * the value "looks present" — so hasRequiredCookies passes and the failure
 * mis-surfaces as "login expired".
 */
export function normalizeCookieValue(raw: string): string {
  let v = raw.trim().replace(/[;,]+$/, '').trim();
  if (v.length >= 2) {
    const q = v[0];
    if ((q === '"' || q === "'") && v[v.length - 1] === q) {
      v = v.slice(1, -1).trim();
    }
  }
  return v;
}

export function parseCookieHeader(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const segment of raw.split(/[;\n]/)) {
    const trimmed = segment.trim();
    if (!trimmed || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const name = trimmed.slice(0, eq).trim();
    const value = normalizeCookieValue(trimmed.slice(eq + 1));
    // Skip empty values so an `ct0=""` paste fails the required-field check
    // (reported as a missing field) instead of poisoning the auth request.
    if (!name || !value) continue;
    out[name] = value;
  }
  return out;
}

export async function loginViaCookieString(
  raw: string,
  meta?: { screenName?: string; name?: string },
): Promise<XAuthStatus> {
  const cookies = parseCookieHeader(raw || '');
  if (!hasRequiredCookies(cookies)) {
    throw new XAuthExpiredError(
      '粘贴的 cookie 缺少必要字段(至少需要 auth_token / ct0 / twid)。' +
      '请在 x.com 已登录页面 → DevTools → Application → Cookies → x.com,把这几条复制成 a=...; b=...; 格式',
    );
  }
  writeCookies(cookies, meta);
  resetScraperCache();
  // 登录成功 → 启用 x-platform MCP,让对话里能用 x_search / x_my_mentions 等工具。
  setXMcpEnabled(true);
  // 同步给 DeepSearch:saveDeepSearchSite 把原始 cookie 字符串写到
  // deepsearch_sites.cookie_value, 然后 probe 时会 import 到 BrowserManager
  // 再扫 → 标记 connected。
  await syncToDeepSearch(raw);
  return await getAuthStatus({ refreshFromGraphQL: true });
}

async function syncToDeepSearch(rawCookieString: string): Promise<void> {
  console.log('[x-auth] syncToDeepSearch start, cookie length:', rawCookieString.length);
  try {
    const mod = await import('@/lib/deepsearch/service');
    const site = await mod.saveDeepSearchSite({
      siteKey: 'x',
      displayName: 'X / Twitter',
      baseUrl: 'https://x.com',
      cookieValue: rawCookieString,
    });
    console.log('[x-auth] saveDeepSearchSite returned:', {
      siteKey: site.siteKey,
      hasCookie: site.hasCookie,
      cookieStatus: site.cookieStatus,
      liveState: site.liveState ? {
        loginState: site.liveState.loginState,
        blockingReason: site.liveState.blockingReason?.slice(0, 200),
        lastError: site.liveState.lastError?.slice(0, 200),
      } : null,
    });
  } catch (err) {
    console.error('[x-auth] syncToDeepSearch FAILED:', err);
  }
}

// 进程启动后只做一次 DeepSearch reconcile,避免每次 status 都跑 probe。
let deepSearchReconciled = false;

// 已登录但 x-platform MCP 还没启用(历史登录 / 登录时还没接这段代码)的存量情况:
// 进程内首次 getAuthStatus 补一次启用。setXMcpEnabled 幂等,gate 只为省下重复查询。
let xMcpReconciled = false;
function ensureXMcpEnabledOnce(): void {
  if (xMcpReconciled) return;
  xMcpReconciled = true;
  try {
    setXMcpEnabled(true);
  } catch (err) {
    console.warn('[x-auth] enable x-platform mcp failed:', err);
  }
}

async function reconcileDeepSearchIfNeeded(rawForReconcile: () => string): Promise<void> {
  if (deepSearchReconciled) return;
  deepSearchReconciled = true;
  try {
    const mod = await import('@/lib/deepsearch/service');
    const { getDeepSearchSiteCookieValue } = await import('@/lib/db/deepsearch');
    const existing = getDeepSearchSiteCookieValue('x');
    if (existing && existing.length > 0) {
      console.log('[x-auth] deepsearch X already has cookie_value, skip reconcile');
      return;
    }
    const raw = rawForReconcile();
    if (!raw) return;
    console.log('[x-auth] reconcile: deepsearch X cookie_value empty but local has cookies, syncing now (length=' + raw.length + ')');
    const site = await mod.saveDeepSearchSite({
      siteKey: 'x',
      displayName: 'X / Twitter',
      baseUrl: 'https://x.com',
      cookieValue: raw,
    });
    console.log('[x-auth] reconcile complete:', {
      hasCookie: site.hasCookie,
      cookieStatus: site.cookieStatus,
      liveState: site.liveState ? {
        loginState: site.liveState.loginState,
        blockingReason: site.liveState.blockingReason?.slice(0, 200),
        lastError: site.liveState.lastError?.slice(0, 200),
      } : null,
    });
  } catch (err) {
    console.error('[x-auth] reconcile FAILED:', err);
  }
}

export async function getAuthStatus(
  opts: { refreshFromGraphQL?: boolean } = {},
): Promise<XAuthStatus> {
  const stored = readCookies();
  if (!stored || !hasRequiredCookies(stored.cookies)) {
    return { loggedIn: false, userId: '', screenName: '', name: '' };
  }
  const userId = userIdFromCookies(stored.cookies);
  // 用户在 paste cookie 时可选填写的 @username / 显示名,优先用,留空则 fallback。
  const base: XAuthStatus = {
    loggedIn: true,
    userId,
    screenName: stored.meta?.screenName || '',
    name: stored.meta?.name || '',
  };

  // 已登录 → 确保 x-platform MCP 启用(覆盖历史已登录但 MCP 没开的存量用户)。
  ensureXMcpEnabledOnce();

  // 进程启动后(或之前 paste 时同步代码还没写)首次 status,补一次 DeepSearch
  // sync。本机有 cookies 但 deepsearch_sites.cookie_value 空 → 自动写入并 probe。
  void reconcileDeepSearchIfNeeded(() => Object.entries(stored.cookies)
    .map(([k, v]) => `${k}=${v}`).join('; '));

  if (!opts.refreshFromGraphQL) return base;

  try {
    const scraper = await ensureScraper();
    const ok = await scraper.isLoggedIn();
    if (!ok) return { loggedIn: false, userId: '', screenName: '', name: '' };
    return base;
  } catch (err) {
    if (err instanceof XAuthExpiredError) {
      return { loggedIn: false, userId: '', screenName: '', name: '' };
    }
    return base;
  }
}

export async function logout(): Promise<void> {
  clearCookies();
  resetScraperCache();
  // 登出 → 关闭 x-platform MCP,避免未登录状态下工具报错污染 Agent 上下文。
  setXMcpEnabled(false);
  xMcpReconciled = false;
  // Reset the once-per-process gate so a subsequent login (especially via
  // the builtin browser path) re-runs reconcile and re-populates DeepSearch
  // with the new account's cookies. Without this, the gate stays true from
  // the previous session and DeepSearch lags one account behind.
  deepSearchReconciled = false;
  // 同步清掉 DeepSearch DB 里 X 站点的 cookieValue:写空字符串就行,
  // 内部会标记 hasCookie=false,下次 probe 就回 missing 状态。
  try {
    const mod = await import('@/lib/deepsearch/service');
    await mod.saveDeepSearchSite({
      siteKey: 'x',
      displayName: 'X / Twitter',
      baseUrl: 'https://x.com',
      cookieValue: '',
    });
  } catch (err) {
    console.warn('[x-auth] failed to clear deepsearch X cookie:', err);
  }
}

export async function openHomeInBuiltinBrowser(): Promise<void> {
  const config = resolveBridgeConfig();
  if (!config) throw new XBrowserUnavailableError('Lumos 内置浏览器不可用');
  await postToBrowserBridge<BridgeNewPageResponse>(
    config, '/v1/pages/new', { url: X_HOME_URL, background: false }, { timeoutMs: 60_000 },
  );
}
