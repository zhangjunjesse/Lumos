/**
 * 扫码登录路径(Lumos 内置浏览器优先,Playwright sidecar 兜底)。
 *
 * 从 auth.ts 拆出来:auth.ts 主要负责 status/login/logout 调度,QR 流程的
 * cookie 收集逻辑量大且独立,放这里让两个文件都不超过 300 行。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  checkBrowserBridgeReady,
  getFromBrowserBridge,
  postToBrowserBridge,
  resolveBrowserBridgeRuntimeConfig,
  type BrowserBridgeResponse,
  type BrowserBridgeRuntimeConfig,
} from '@/lib/browser-runtime/bridge-client';

import { GoofishCliException } from './cli';
import { listAccounts } from './accounts';
import { findGoofishPython, buildGoofishEnv } from './env';
import { cookieDomainForName, writeCookieRecord } from './cookie-store';

const DEFAULT_BRIDGE_CONTEXT_ID = 'embedded:default';
const BRIDGE_OWNER_ID = 'goofish-qr-login';
const GOOFISH_HOME_URL = 'https://www.goofish.com/';
const QR_REQUIRED_COOKIES = ['_m_h5_tk', 'unb', 'cookie2'] as const;
const QR_COOKIE_CAPTURE_URLS = [
  GOOFISH_HOME_URL,
  'https://h5api.m.goofish.com/',
  'https://h5api.m.taobao.com/',
  'https://login.taobao.com/',
] as const;

export class BuiltinBrowserQrUnavailableError extends Error {}

interface BridgeCookieWithValue {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
  expirationDate?: number | null;
}

interface BridgeCookiesResponse extends BrowserBridgeResponse {
  cookies?: BridgeCookieWithValue[];
}

interface BridgeNewPageResponse extends BrowserBridgeResponse {
  pageId?: string;
}

export function resolveBuiltinBrowserQrConfig(
  contextId?: string,
): BrowserBridgeRuntimeConfig | null {
  return resolveBrowserBridgeRuntimeConfig({
    browserContextId: (contextId ?? '').trim() || DEFAULT_BRIDGE_CONTEXT_ID,
    lockOwnerId: BRIDGE_OWNER_ID,
  });
}

export async function runBuiltinBrowserQrLogin(
  timeoutSecs: number,
  cookiesOut: string,
  browserContextId?: string,
): Promise<void> {
  const config = resolveBuiltinBrowserQrConfig(browserContextId);
  if (!config) {
    const label = browserContextId && browserContextId !== DEFAULT_BRIDGE_CONTEXT_ID
      ? `所选浏览器（${browserContextId}）不可用，请到「设置 → 浏览器接入」检查是否开启并测试通过`
      : 'Lumos 内置浏览器不可用';
    throw new BuiltinBrowserQrUnavailableError(label);
  }

  // 用户选了非默认浏览器（AdsPower / CDP）= 明确意图「用这个浏览器当前的登录态」，
  // 不应该被「这个 unb 已存在」挡住——直接覆盖。
  // 只有默认 embedded 浏览器才保留旧的「不重复保存同 unb」防呆逻辑。
  const isExternalBrowser = Boolean(browserContextId)
    && browserContextId !== DEFAULT_BRIDGE_CONTEXT_ID;
  const ignoredUnbs = isExternalBrowser
    ? new Set<string>()
    : new Set(
      listAccounts()
        .filter((account) => account.hasCookies)
        .map((account) => account.unb),
    );
  let pageId = '';
  try {
    const health = await checkBrowserBridgeReady(config);
    if (!health.ready) {
      console.warn('[goofish-auth] browser bridge health check returned non-ready status, continuing with QR flow:', health.status, health.error || '');
    }

    // Step 1: open empty tab as foreground (background:false). The QR login
    // is a user-explicit action (CLAUDE.md exception for "user manually
    // requested open login page"), not an automation task. background:false
    // makes the tab active so its view tracks the BrowserManager panelBounds
    // we set from GoofishLoginBrowserModal's setDisplayTarget('panel', rect).
    // Empty url avoids the ERR_ABORTED death path where createTab+navigate
    // are atomic.
    const created = await postToBrowserBridge<BridgeNewPageResponse>(
      config,
      '/v1/pages/new',
      { background: false },
      { timeoutMs: 60_000 },
    );
    pageId = typeof created.pageId === 'string' ? created.pageId : '';
    if (!pageId) {
      throw new Error('Lumos 内置浏览器未返回 pageId');
    }

    // Step 2: navigate. If loadURL gets superseded by a redirect, Electron
    // rejects with ERR_ABORTED (-3). The page actually loads — we tolerate
    // the rejection and proceed to cookie polling.
    try {
      await postToBrowserBridge(
        config,
        '/v1/pages/navigate',
        { pageId, url: GOOFISH_HOME_URL },
        { timeoutMs: 60_000 },
      );
    } catch (navErr) {
      const msg = navErr instanceof Error ? navErr.message : String(navErr);
      if (!/ERR_ABORTED|-3\b/i.test(msg)) {
        throw navErr;
      }
      console.warn('[goofish-auth] navigate ERR_ABORTED tolerated; page likely redirected:', msg);
    }

    const cookies = await waitForBuiltinBrowserQrCookies(config, timeoutSecs, ignoredUnbs);
    writeGoofishCookiesJson(cookiesOut, cookies);
  } catch (err) {
    if (err instanceof GoofishCliException || err instanceof BuiltinBrowserQrUnavailableError) {
      throw err;
    }
    throw new BuiltinBrowserQrUnavailableError(`Lumos 内置浏览器扫码登录失败：${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (pageId) {
      await postToBrowserBridge(config, '/v1/pages/close', { pageId }, { timeoutMs: 15_000 }).catch(() => undefined);
    }
  }
}

async function waitForBuiltinBrowserQrCookies(
  config: BrowserBridgeRuntimeConfig,
  timeoutSecs: number,
  ignoredUnbs: Set<string>,
): Promise<Record<string, string>> {
  const deadline = Date.now() + timeoutSecs * 1000;
  let lastIgnoredUnb = '';
  while (Date.now() < deadline) {
    await sleep(2000);
    const cookies = await collectGoofishCookiesFromBridge(config);
    if (QR_REQUIRED_COOKIES.every((name) => Boolean(cookies[name])) && ignoredUnbs.has(cookies.unb)) {
      lastIgnoredUnb = cookies.unb;
    }
    if (hasAcceptableQrCookies(cookies, ignoredUnbs)) {
      await sleep(2000);
      const finalCookies = await collectGoofishCookiesFromBridge(config);
      if (hasAcceptableQrCookies(finalCookies, ignoredUnbs)) {
        return finalCookies;
      }
    }
  }
  throw new GoofishCliException({
    code: 'AUTH_FAILED',
    message: lastIgnoredUnb
      ? `当前 Lumos 浏览器仍是已保存账号 #${lastIgnoredUnb}，请在打开的闲鱼页面切换到新账号后重试`
      : '扫码超时或未确认登录',
  });
}

function hasAcceptableQrCookies(cookies: Record<string, string>, ignoredUnbs: Set<string>): boolean {
  if (!QR_REQUIRED_COOKIES.every((name) => Boolean(cookies[name]))) {
    return false;
  }
  return ignoredUnbs.size === 0 || !ignoredUnbs.has(cookies.unb);
}

async function collectGoofishCookiesFromBridge(
  config: BrowserBridgeRuntimeConfig,
): Promise<Record<string, string>> {
  const selected = new Map<string, BridgeCookieWithValue>();
  for (const url of QR_COOKIE_CAPTURE_URLS) {
    const response = await getFromBrowserBridge<BridgeCookiesResponse>(
      config,
      `/v1/cookies?url=${encodeURIComponent(url)}&includeValues=1`,
      { timeoutMs: 15_000 },
    );
    mergeBridgeCookiesForGoofish(selected, response.cookies ?? []);
  }
  return bridgeCookieMapToRecord(selected);
}

function mergeBridgeCookiesForGoofish(
  selected: Map<string, BridgeCookieWithValue>,
  cookies: BridgeCookieWithValue[],
): void {
  for (const cookie of cookies) {
    if (!cookie?.name || typeof cookie.value !== 'string' || cookie.value.length === 0) {
      continue;
    }
    const previous = selected.get(cookie.name);
    if (!previous || shouldPreferCookie(cookie.name, previous, cookie)) {
      selected.set(cookie.name, cookie);
    }
  }
}

function bridgeCookieMapToRecord(selected: Map<string, BridgeCookieWithValue>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, cookie] of selected) {
    if (typeof cookie.value === 'string' && cookie.value) {
      out[name] = cookie.value;
    }
  }
  return out;
}

function shouldPreferCookie(name: string, previous: BridgeCookieWithValue, next: BridgeCookieWithValue): boolean {
  if (cookieDomainForName(name) === '.taobao.com') {
    const previousTaobao = cookieDomainMatches(previous, 'taobao.com');
    const nextTaobao = cookieDomainMatches(next, 'taobao.com');
    if (nextTaobao !== previousTaobao) {
      return nextTaobao;
    }
  }

  const previousGoofish = cookieDomainMatches(previous, 'goofish.com');
  const nextGoofish = cookieDomainMatches(next, 'goofish.com');
  if (nextGoofish !== previousGoofish) {
    return nextGoofish;
  }

  const previousExpiry = typeof previous.expirationDate === 'number' ? previous.expirationDate : 0;
  const nextExpiry = typeof next.expirationDate === 'number' ? next.expirationDate : 0;
  return nextExpiry > previousExpiry;
}

function cookieDomainMatches(cookie: BridgeCookieWithValue, suffix: string): boolean {
  const domain = (cookie.domain || '').replace(/^\./, '').toLowerCase();
  return domain === suffix || domain.endsWith(`.${suffix}`);
}

function writeGoofishCookiesJson(cookiesOut: string, cookies: Record<string, string>): void {
  writeCookieRecord(cookiesOut, cookies);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Playwright sidecar fallback。仅在 Lumos 内置浏览器不可用且用户已下载备用
 * 扫码组件时使用。SIGTERM 给 Python finally(rmtree profile_dir)宽限,5s 后
 * SIGKILL 兜底。
 */
export async function runQrSidecar(timeoutSecs: number, cookiesOut: string): Promise<void> {
  const py = findGoofishPython();
  const runtimePath = process.resourcesPath && existsSync(path.join(process.resourcesPath, 'mcp-servers'))
    ? process.resourcesPath
    : path.join(process.cwd(), 'resources');
  const script = path.join(runtimePath, 'mcp-servers', 'goofish', 'qr_login_fat.py');
  if (!existsSync(script)) {
    throw new GoofishCliException({ code: 'NOT_INSTALLED', message: `qr_login_fat.py missing at ${script}` });
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn(py, [script, '--timeout', String(timeoutSecs), '--cookies-out', cookiesOut], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: buildGoofishEnv(),
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      const sigKillFallback = setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5_000);
      child.once('close', () => clearTimeout(sigKillFallback));
      reject(new GoofishCliException({ code: 'EXEC_FAILED', message: 'QR sidecar timed out' }));
    }, (timeoutSecs + 60) * 1000);
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(new GoofishCliException({
        code: code === 2 ? 'AUTH_FAILED' : 'EXEC_FAILED',
        message: code === 2 ? '扫码超时或未确认登录' : `qr_login exited ${code}`,
        stderr,
      }));
    });
  });
}

export const __goofishAuthQrTestInternals = {
  bridgeCookieMapToRecord,
  cookieDomainMatches,
  hasAcceptableQrCookies,
  mergeBridgeCookiesForGoofish,
  shouldPreferCookie,
  writeGoofishCookiesJson,
};
