/**
 * X (Twitter) 登录: 通过 Lumos 内置浏览器让用户在 x.com 完成登录,bridge 抓
 * cookie 写到 ./cookies-store。和 goofish 内置浏览器扫码登录同源,但 X 没扫码
 * 登录, 需要用户输入用户名/密码或 SSO。
 *
 * 流程:
 *   1. 在内置浏览器打开 x.com/login (前台,让用户能交互)
 *   2. 每 2s 轮询 bridge 的 /v1/cookies, 一旦收齐 auth_token+ct0+twid 就成功
 *   3. 调 viewer GraphQL 查 screen_name / name 写入 status 缓存
 *   4. 关闭登录页(用户已登录到内置浏览器 partition,cookie 持久)
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
import { gqlGet } from './graphql-client';
import { VIEWER } from './graphql-queries';
import type { XAuthStatus } from './types';

const BRIDGE_CONTEXT_ID = 'embedded:default';
const BRIDGE_OWNER_ID = 'x-platform-login';
const X_LOGIN_URL = 'https://x.com/i/flow/login';
const X_HOME_URL = 'https://x.com/home';
const X_COOKIE_CAPTURE_URLS = [
  'https://x.com/',
  'https://twitter.com/',
] as const;

// 仅保留 X 鉴权用得上的 cookie 名,避免把无关的 personalization / consent cookie
// 也写到本地。auth_token + ct0 + twid 是必需,其余是可选的助力字段。
const X_COOKIE_NAMES = new Set([
  'auth_token', 'ct0', 'twid', 'guest_id', 'kdt', 'auth_multi',
  'guest_id_marketing', 'guest_id_ads', 'personalization_id',
]);

interface BridgeCookieWithValue {
  name?: string;
  value?: string;
  domain?: string;
}

interface BridgeCookiesResponse extends BrowserBridgeResponse {
  cookies?: BridgeCookieWithValue[];
}

interface BridgeNewPageResponse extends BrowserBridgeResponse {
  pageId?: string;
}

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

export interface StartLoginOptions {
  /** 等待用户登录的最大秒数。默认 5 分钟。 */
  timeoutSecs?: number;
}

export async function loginViaBuiltinBrowser(opts: StartLoginOptions = {}): Promise<XAuthStatus> {
  const config = resolveBridgeConfig();
  if (!config) {
    throw new XBrowserUnavailableError('Lumos 内置浏览器不可用,无法登录 X');
  }
  const timeoutSecs = Math.max(60, Math.min(900, opts.timeoutSecs ?? 300));

  const health = await checkBrowserBridgeReady(config);
  if (!health.ready) {
    console.warn('[x-auth] browser bridge not ready, continuing:', health.status);
  }

  let pageId = '';
  try {
    const created = await postToBrowserBridge<BridgeNewPageResponse>(
      config,
      '/v1/pages/new',
      { url: X_LOGIN_URL, background: false },
      { timeoutMs: 60_000 },
    );
    pageId = typeof created.pageId === 'string' ? created.pageId : '';

    const cookies = await waitForLoginCookies(config, timeoutSecs);
    writeCookies(cookies);
  } finally {
    if (pageId) {
      await postToBrowserBridge(config, '/v1/pages/close', { pageId }, { timeoutMs: 15_000 }).catch(() => undefined);
    }
  }

  // 写完 cookie 后用 viewer 查询验证 + 拿用户信息。
  return await getAuthStatus({ refreshFromGraphQL: true });
}

async function waitForLoginCookies(
  config: BrowserBridgeRuntimeConfig,
  timeoutSecs: number,
): Promise<Record<string, string>> {
  const deadline = Date.now() + timeoutSecs * 1000;
  while (Date.now() < deadline) {
    await sleep(2000);
    const cookies = await collectCookiesFromBridge(config);
    if (hasRequiredCookies(cookies)) {
      // 等 2s 让 ct0/auth_token 在浏览器 IDB / cookie store 完整提交,避免抓
      // 到一半的 cookie。
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
      config,
      `/v1/cookies?url=${encodeURIComponent(url)}&includeValues=1`,
      { timeoutMs: 15_000 },
    );
    for (const cookie of response.cookies ?? []) {
      if (!cookie?.name || typeof cookie.value !== 'string' || !cookie.value) continue;
      if (!X_COOKIE_NAMES.has(cookie.name)) continue;
      // 先来后到,但 .x.com 域优先级高于 .twitter.com (旧域)。
      const isXDomain = (cookie.domain || '').replace(/^\./, '').toLowerCase().endsWith('x.com');
      if (!(cookie.name in out) || isXDomain) {
        out[cookie.name] = cookie.value;
      }
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ViewerData {
  viewer?: {
    user_results?: {
      result?: {
        legacy?: { screen_name?: string; name?: string };
      };
    };
  };
}

export async function getAuthStatus(
  opts: { refreshFromGraphQL?: boolean } = {},
): Promise<XAuthStatus> {
  const stored = readCookies();
  if (!stored || !hasRequiredCookies(stored.cookies)) {
    return { loggedIn: false, userId: '', screenName: '', name: '' };
  }
  const userId = userIdFromCookies(stored.cookies);
  const base: XAuthStatus = { loggedIn: true, userId, screenName: '', name: '' };

  if (!opts.refreshFromGraphQL) return base;

  try {
    const data = await gqlGet<ViewerData>(VIEWER);
    const legacy = data?.viewer?.user_results?.result?.legacy;
    return {
      ...base,
      screenName: legacy?.screen_name || '',
      name: legacy?.name || '',
    };
  } catch (err) {
    if (err instanceof XAuthExpiredError) {
      // cookie 看似齐, 但服务器认为过期 → 当作未登录
      return { loggedIn: false, userId: '', screenName: '', name: '' };
    }
    // viewer 查询失败但本地有 cookie, 仍认为登录中(避免误显示已退出)
    return base;
  }
}

export function logout(): void {
  clearCookies();
}

/**
 * 把用户粘贴的 Cookie 字符串(`a=1; b=2; ...` 或一行一对)解析成 record。
 * 用户从 x.com DevTools → Application → Cookies 复制,或从 Network 任意请求
 * 的 `Cookie:` 头复制都可以。
 */
function parseCookieHeader(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const segment of raw.split(/[;\n]/)) {
    const trimmed = segment.trim();
    if (!trimmed || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!name) continue;
    out[name] = value;
  }
  return out;
}

export async function loginViaCookieString(raw: string): Promise<XAuthStatus> {
  const cookies = parseCookieHeader(raw || '');
  if (!hasRequiredCookies(cookies)) {
    throw new XAuthExpiredError(
      '粘贴的 cookie 缺少必要字段(至少需要 auth_token / ct0 / twid)。' +
      '请在 x.com 已登录页面 → DevTools → Application → Cookies → x.com,把这几条复制成 a=...; b=...; 格式',
    );
  }
  writeCookies(cookies);
  return await getAuthStatus({ refreshFromGraphQL: true });
}

export async function openHomeInBuiltinBrowser(): Promise<void> {
  const config = resolveBridgeConfig();
  if (!config) throw new XBrowserUnavailableError('Lumos 内置浏览器不可用');
  await postToBrowserBridge<BridgeNewPageResponse>(
    config,
    '/v1/pages/new',
    { url: X_HOME_URL, background: false },
    { timeoutMs: 60_000 },
  );
}
