/**
 * Auth flows against the goofish CLI: status check, login (browser auto-detect
 * or pasted cookie header), and logout.
 *
 * Split out from cli.ts to keep that file under the 300-line cap. Reuses
 * `runJsonCommand` and `normalizeNick` from cli.ts.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  checkBrowserBridgeReady,
  getFromBrowserBridge,
  postToBrowserBridge,
  resolveBrowserBridgeRuntimeConfig,
  type BrowserBridgeResponse,
  type BrowserBridgeRuntimeConfig,
} from '@/lib/browser-runtime/bridge-client';

import {
  GoofishCliException,
  normalizeNick,
  runJsonCommand,
  type GoofishAuthStatus,
} from './cli';
import { ensureAccountDir, deleteAccount, listAccounts, cookiesPathFor, migrateLegacyAccount } from './accounts';
import { findGoofishPython, buildGoofishEnv } from './env';
import { isQrReady } from './install-state';

const HOME = os.homedir();
const GOOFISH_HOME = path.join(HOME, '.goofish-cli');
const COOKIES_FILE = path.join(GOOFISH_HOME, 'cookies.json');
const BRIDGE_CONTEXT_ID = 'embedded:default';
const BRIDGE_OWNER_ID = 'goofish-qr-login';
const GOOFISH_HOME_URL = 'https://www.goofish.com/';
const QR_REQUIRED_COOKIES = ['_m_h5_tk', 'unb', 'cookie2'] as const;
const QR_COOKIE_CAPTURE_URLS = [
  GOOFISH_HOME_URL,
  'https://h5api.m.goofish.com/',
  'https://h5api.m.taobao.com/',
  'https://login.taobao.com/',
] as const;
const TAOBAO_COOKIE_NAMES = new Set(['_m_h5_tk', '_m_h5_tk_enc', 'x5sec', 'sgcookie', 'cookie2', '_tb_token_']);

type QrLoginMode = 'builtin-browser' | 'playwright' | 'needs-install';

class BuiltinBrowserQrUnavailableError extends Error {}

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

export async function resolveQrLoginMode(): Promise<QrLoginMode> {
  const config = resolveBuiltinBrowserQrConfig();
  if (config) {
    return 'builtin-browser';
  }
  return isQrReady() ? 'playwright' : 'needs-install';
}

/**
 * Status for a SPECIFIC account. Pass `accountUnb` to scope the goofish-cli
 * call (HOME=~/.lumos/goofish-accounts/<unb>/). Without it, falls back to
 * the legacy single-account location (~/.goofish-cli/cookies.json).
 */
export async function getAuthStatus(opts: { allowAutoRefresh?: boolean; accountUnb?: string } = {}): Promise<GoofishAuthStatus | null> {
  const cookiesFile = opts.accountUnb ? cookiesPathFor(opts.accountUnb) : COOKIES_FILE;
  if (!existsSync(cookiesFile)) {
    return null;
  }
  try {
    const data = await runJsonCommand(
      ['auth', 'status'],
      { timeoutMs: 30_000, allowAutoRefresh: opts.allowAutoRefresh, cookiesPath: opts.accountUnb ? cookiesFile : undefined },
    ) as GoofishAuthStatus;
    return { ...data, tracknick: normalizeNick(data.tracknick), nick: normalizeNick(data.nick) };
  } catch (err) {
    if (err instanceof GoofishCliException && err.code === 'EXEC_FAILED') {
      return { unb: '', tracknick: '', nick: '', valid: false };
    }
    throw err;
  }
}

export interface AccountStatusEntry extends GoofishAuthStatus {
  /** Account directory unb (matches the cookies' unb when valid). */
  accountUnb: string;
}

/**
 * Status for ALL accounts. Migrates the legacy single-account on first call.
 * Returns one entry per account directory under ~/.lumos/goofish-accounts/,
 * each with valid/nick/tracknick filled by hitting goofish-cli for that home.
 */
export async function listAccountStatuses(): Promise<AccountStatusEntry[]> {
  migrateLegacyAccount();
  const accounts = listAccounts().filter((a) => a.hasCookies);
  const out: AccountStatusEntry[] = [];
  for (const acc of accounts) {
    try {
      const status = await getAuthStatus({ accountUnb: acc.unb });
      if (status) out.push({ ...status, accountUnb: acc.unb });
    } catch {
      out.push({ accountUnb: acc.unb, unb: acc.unb, tracknick: '', nick: '', valid: false });
    }
  }
  return out;
}

/**
 * Login modes:
 *   - 'qr':     prefers Lumos's built-in browser for扫码登录; falls back to
 *               the legacy Playwright Chromium sidecar only when needed.
 *   - 'browser': reads cookies from a system browser via browser_cookie3.
 *               Fast, but requires the user to already be logged in.
 *   - 'paste':  takes a raw Cookie header string from devtools.
 */
export type GoofishLoginInput =
  | { mode: 'qr'; timeoutSecs?: number }
  | { mode: 'browser'; browser?: string }
  | { mode: 'paste'; cookieString: string };

/**
 * Multi-account login. Writes the resulting cookies into a tmp file, reads
 * the unb out, and moves it into ~/.lumos/goofish-accounts/<unb>/cookies.json.
 *
 * We use GOOFISH_COOKIES_PATH (goofish-cli's own override knob) rather than
 * a HOME override — the latter breaks browser_cookie3 (can't find system
 * Chrome) and Python user-site resolution.
 */
export async function login(input: GoofishLoginInput): Promise<AccountStatusEntry> {
  const tempCookies = path.join(os.tmpdir(), `lumos-goofish-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  try {
    await runLoginToCookiesFile(input, tempCookies);
    if (!existsSync(tempCookies)) {
      throw new GoofishCliException({ code: 'AUTH_FAILED', message: 'login completed but no cookies were written' });
    }
    const unb = readUnbFromCookies(tempCookies);
    if (!unb) {
      throw new GoofishCliException({ code: 'AUTH_FAILED', message: 'cookies missing unb field' });
    }
    // Move into permanent per-account location.
    const accountDir = ensureAccountDir(unb);
    const finalCookies = path.join(accountDir, '.goofish-cli', 'cookies.json');
    writeFileSync(finalCookies, readFileSync(tempCookies), { mode: 0o600 });
    // Validate via goofish auth status, scoped to the new cookies file.
    const status = await getAuthStatus({ accountUnb: unb, allowAutoRefresh: true });
    if (!status?.valid) {
      throw new GoofishCliException({ code: 'AUTH_FAILED', message: '登录看似成功但状态校验失败，请重试' });
    }
    return { ...status, accountUnb: unb };
  } finally {
    try { rmSync(tempCookies, { force: true }); } catch { /* ignore */ }
  }
}

async function runLoginToCookiesFile(input: GoofishLoginInput, cookiesPath: string): Promise<void> {
  if (input.mode === 'qr') {
    const timeoutSecs = Math.max(60, Math.min(600, input.timeoutSecs ?? 300));
    try {
      await runBuiltinBrowserQrLogin(timeoutSecs, cookiesPath);
      return;
    } catch (err) {
      if (err instanceof GoofishCliException && err.code === 'AUTH_FAILED') {
        throw err;
      }
      if (!(err instanceof BuiltinBrowserQrUnavailableError)) {
        throw err;
      }
      if (isQrReady()) {
        console.warn('[goofish-auth] builtin browser QR unavailable, falling back to Playwright:', err.message);
        await runQrSidecar(timeoutSecs, cookiesPath);
        return;
      }
      throw new GoofishCliException({
        code: 'NOT_INSTALLED',
        message: `${err.message}。如果当前不是 Lumos 桌面端，请先下载备用扫码浏览器组件后再试。`,
      });
    }
  }
  if (input.mode === 'paste') {
    const items = parseCookieString(input.cookieString);
    if (items.length === 0) {
      throw new GoofishCliException({ code: 'AUTH_FAILED', message: '解析 cookie 失败 — 请粘贴完整的 Cookie 头' });
    }
    const sourceFile = `${cookiesPath}.import`;
    writeFileSync(sourceFile, JSON.stringify(items, null, 2), { mode: 0o600 });
    try {
      await runJsonCommand(['auth', 'login', '--source', sourceFile], { timeoutMs: 30_000, allowAutoRefresh: true, cookiesPath });
    } finally {
      try { rmSync(sourceFile, { force: true }); } catch { /* ignore */ }
    }
    return;
  }
  // browser mode — DO NOT override cookies path: goofish-cli's
  // _pull_from_browser uses real HOME to find Chrome, and writes the
  // cookies.json to GOOFISH_COOKIES_PATH (when set).
  const args = ['auth', 'login'];
  if (input.browser && input.browser !== 'auto') args.push('--browser', input.browser);
  await runJsonCommand(args, { timeoutMs: 90_000, allowAutoRefresh: true, cookiesPath });
}

function readUnbFromCookies(cookiesPath: string): string {
  try {
    const raw = readFileSync(cookiesPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const found = parsed.find((c) => c?.name === 'unb' && c?.value);
      return found?.value ?? '';
    }
    return parsed?.unb ?? '';
  } catch {
    return '';
  }
}

function resolveBuiltinBrowserQrConfig(): BrowserBridgeRuntimeConfig | null {
  return resolveBrowserBridgeRuntimeConfig({
    browserContextId: BRIDGE_CONTEXT_ID,
    lockOwnerId: BRIDGE_OWNER_ID,
  });
}

async function runBuiltinBrowserQrLogin(timeoutSecs: number, cookiesOut: string): Promise<void> {
  const config = resolveBuiltinBrowserQrConfig();
  if (!config) {
    throw new BuiltinBrowserQrUnavailableError('Lumos 内置浏览器不可用');
  }

  const ignoredUnbs = new Set(
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

    const created = await postToBrowserBridge<BridgeNewPageResponse>(
      config,
      '/v1/pages/new',
      { url: GOOFISH_HOME_URL, background: false },
      { timeoutMs: 60_000 },
    );
    pageId = typeof created.pageId === 'string' ? created.pageId : '';

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
  if (TAOBAO_COOKIE_NAMES.has(name)) {
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
  const payload = Object.entries(cookies)
    .filter(([name, value]) => Boolean(name) && Boolean(value))
    .map(([name, value]) => ({ name, value }));
  writeFileSync(cookiesOut, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Logout a specific account by deleting its directory. Pass no unb to
 * clear the legacy single-account location (back-compat).
 */
export function logout(unb?: string): void {
  if (unb) {
    deleteAccount(unb);
    return;
  }
  if (existsSync(COOKIES_FILE)) {
    rmSync(COOKIES_FILE, { force: true });
  }
}

/**
 * Convert a raw `Cookie:` header string into the chrome-export JSON array
 * format goofish-cli's `auth login --source` expects. Single cookie file
 * lives at `~/.goofish-cli/cookies.json` after import.
 */
async function runQrSidecar(timeoutSecs: number, cookiesOut: string): Promise<void> {
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
      child.kill('SIGKILL');
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

function parseCookieString(raw: string): Array<Record<string, unknown>> {
  const expires = Math.floor(Date.now() / 1000) + 30 * 86400;
  const out: Array<Record<string, unknown>> = [];
  for (const kv of raw.split(';')) {
    const trimmed = kv.trim();
    if (!trimmed || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!name) continue;
    out.push({
      name,
      value,
      domain: '.goofish.com',
      path: '/',
      expires,
      httpOnly: false,
      secure: true,
      sameSite: 'no_restriction',
    });
  }
  return out;
}

export const __goofishAuthTestInternals = {
  bridgeCookieMapToRecord,
  cookieDomainMatches,
  hasAcceptableQrCookies,
  mergeBridgeCookiesForGoofish,
  shouldPreferCookie,
  writeGoofishCookiesJson,
};
