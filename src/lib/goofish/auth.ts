/**
 * Auth flows against the goofish CLI: status check, login (browser auto-detect
 * or pasted cookie header), and logout.
 *
 * Split out from cli.ts to keep that file under the 300-line cap. Reuses
 * `runJsonCommand` and `normalizeNick` from cli.ts. QR 扫码登录的 cookie
 * 收集逻辑量大,拆到 ./auth-qr.ts。
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  GoofishCliException,
  normalizeNick,
  runJsonCommand,
  type GoofishAuthStatus,
} from './cli';
import { ensureAccountDir, deleteAccount, listAccounts, cookiesPathFor, migrateLegacyAccount } from './accounts';
import { isQrReady } from './install-state';
import {
  BuiltinBrowserQrUnavailableError,
  resolveBuiltinBrowserQrConfig,
  runBuiltinBrowserQrLogin,
  runQrSidecar,
} from './auth-qr';

const HOME = os.homedir();
const GOOFISH_HOME = path.join(HOME, '.goofish-cli');
const COOKIES_FILE = path.join(GOOFISH_HOME, 'cookies.json');

type QrLoginMode = 'builtin-browser' | 'playwright' | 'needs-install';

export async function resolveQrLoginMode(): Promise<QrLoginMode> {
  if (resolveBuiltinBrowserQrConfig()) return 'builtin-browser';
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
