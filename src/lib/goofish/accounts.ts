/**
 * Multi-account management for goofish.
 *
 * Each goofish account lives in its own directory under
 * `~/.lumos/goofish-accounts/<unb>/`. Lumos owns the account cookie file and
 * passes it to goofish-cli via GOOFISH_COOKIES_PATH. We intentionally avoid
 * changing HOME for browser-cookie imports because that breaks user-site
 * Python package resolution and browser profile discovery.
 *
 * Layout:
 *   ~/.lumos/goofish-accounts/
 *   ├── 2231807063/                         (Lumos account state dir)
 *   │   └── .goofish-cli/
 *   │       └── cookies.json
 *   └── ...
 */

import { existsSync, readdirSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ACCOUNTS_ROOT = path.join(
  process.env.LUMOS_DATA_DIR || path.join(os.homedir(), '.lumos'),
  'goofish-accounts',
);

export interface GoofishAccountInfo {
  unb: string;
  /** Lumos-managed account state directory. This is not passed as process HOME. */
  homeDir: string;
  cookiesPath: string;
  /** True if cookies.json exists; doesn't necessarily mean the cookies are valid. */
  hasCookies: boolean;
}

export function accountsRoot(): string {
  return ACCOUNTS_ROOT;
}

/**
 * goofish 账号 unb 一定是 mtop 返回的纯数字 ID。校验防止 ?account=../../path
 * 这类用户控制输入越出 ACCOUNTS_ROOT 读到任意 cookies.json(虽然桌面 app 在
 * localhost,但 AI 工具调用是攻击面)。
 */
function assertValidUnb(unb: string): void {
  if (!unb || !/^\d+$/.test(unb)) {
    throw new Error(`Invalid goofish account unb: ${JSON.stringify(unb)}`);
  }
}

export function homeForAccount(unb: string): string {
  assertValidUnb(unb);
  return path.join(ACCOUNTS_ROOT, unb);
}

export function cookiesPathFor(unb: string): string {
  return path.join(homeForAccount(unb), '.goofish-cli', 'cookies.json');
}

export function ensureAccountDir(unb: string): string {
  const home = homeForAccount(unb);
  mkdirSync(path.join(home, '.goofish-cli'), { recursive: true });
  return home;
}

/**
 * Return the list of accounts we know about — one per directory under
 * ACCOUNTS_ROOT. The directory name IS the unb.
 */
export function listAccounts(): GoofishAccountInfo[] {
  if (!existsSync(ACCOUNTS_ROOT)) return [];
  const out: GoofishAccountInfo[] = [];
  for (const entry of readdirSync(ACCOUNTS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!/^\d+$/.test(entry.name)) continue;  // unb is numeric
    const home = path.join(ACCOUNTS_ROOT, entry.name);
    const cookiesPath = path.join(home, '.goofish-cli', 'cookies.json');
    out.push({
      unb: entry.name,
      homeDir: home,
      cookiesPath,
      hasCookies: existsSync(cookiesPath),
    });
  }
  return out;
}

export function deleteAccount(unb: string): boolean {
  const home = homeForAccount(unb);
  if (!existsSync(home)) return false;
  rmSync(home, { recursive: true, force: true });
  return true;
}

/**
 * Migrate a one-time legacy login from ~/.goofish-cli/cookies.json into
 * the multi-account layout, preserving the user's existing session.
 *
 * We read cookies.json (which has `unb` inside), figure out the account,
 * and copy its cookies.json under
 * ~/.lumos/goofish-accounts/<unb>/.goofish-cli/. The legacy directory is
 * left in place so single-account fallback callers still work.
 *
 * Idempotent: if the destination already exists, returns existing unb.
 */
export function migrateLegacyAccount(): string | null {
  const legacyHome = os.homedir();
  const legacyCookies = path.join(legacyHome, '.goofish-cli', 'cookies.json');
  if (!existsSync(legacyCookies)) return null;

  let unb: string;
  try {
    const raw = readFileSync(legacyCookies, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const found = parsed.find((c) => c?.name === 'unb' && c?.value);
      unb = found?.value as string;
    } else {
      unb = parsed?.unb as string;
    }
    if (!unb) return null;
  } catch {
    return null;
  }

  const dest = homeForAccount(unb);
  if (existsSync(path.join(dest, '.goofish-cli', 'cookies.json'))) return unb;

  const destDir = path.join(dest, '.goofish-cli');
  mkdirSync(destDir, { recursive: true });
  try {
    writeFileSync(path.join(destDir, 'cookies.json'), readFileSync(legacyCookies), { mode: 0o600 });
  } catch { /* best effort */ }
  return unb;
}
