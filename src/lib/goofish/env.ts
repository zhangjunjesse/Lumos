/**
 * Shared spawn-environment builder for goofish-cli and our Python sidecars.
 *
 * Why this exists: we override HOME per-account so each account's
 * ~/.goofish-cli/ state stays isolated. But HOME also drives Python's
 * user-site resolution, so a child process started with HOME=<tmp> can't
 * find the real user-site where goofish_cli is installed. We pass the
 * real user-site back via PYTHONPATH (Python startup) and LUMOS_USER_SITE
 * (our sidecars sys.path.insert it before any imports).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function findGoofishPython(): string {
  const home = os.homedir();
  for (const c of [
    path.join(home, '.local', 'bin', 'goofish'),
    path.join(home, '.local', 'bin', 'goofish-mcp'),
  ]) {
    if (!existsSync(c)) continue;
    try {
      const first = readFileSync(c, 'utf-8').split('\n')[0];
      if (first.startsWith('#!')) {
        const py = first.slice(2).trim().split(/\s+/)[0];
        if (py && existsSync(py)) return py;
      }
    } catch { /* ignore */ }
  }
  return 'python3';
}

let userSiteCache: string | null = null;
export function getRealUserSite(py?: string): string {
  if (userSiteCache) return userSiteCache;
  const interp = py || findGoofishPython();
  try {
    const out = execFileSync(interp, ['-m', 'site', '--user-site'], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (out) {
      userSiteCache = out;
      return out;
    }
    console.warn('[goofish] python -m site --user-site returned empty');
  } catch (err) {
    console.warn('[goofish] failed to discover user-site:', (err as Error).message);
  }
  // Fallback: probe common ~/.local/lib/pythonX.Y/site-packages locations
  // for the goofish_cli package itself.
  const home = os.homedir();
  for (const v of ['3.13', '3.12', '3.11', '3.10', '3.9']) {
    for (const base of [
      path.join(home, '.local', 'lib', `python${v}`, 'site-packages'),
      path.join(home, 'Library', 'Python', v, 'lib', 'python', 'site-packages'),
    ]) {
      if (existsSync(path.join(base, 'goofish_cli'))) {
        userSiteCache = base;
        return base;
      }
    }
  }
  return '';
}

/**
 * Env for spawning the goofish CLI or one of our Python sidecars.
 *
 * Per-account isolation: GOOFISH_COOKIES_PATH (NOT HOME override) — the
 * latter breaks browser_cookie3 + Python user-site.
 *
 * Token auto-refresh:
 *   - `_m_h5_tk` expires every 10min. Without refresh, the AI / panel sees
 *     `valid: false` until the user manually re-logs in. Awful UX.
 *   - goofish-cli's refresh path uses Playwright Chrome to goto goofish.com
 *     and capture freshly-issued cookies. Default = headful (visible window).
 *   - We force GOOFISH_HEADLESS=1 so the refresh runs invisibly. If that
 *     gets risk-controlled by goofish, the refresh fails silently and the
 *     user does have to re-login — same as before, no worse.
 */
export function buildGoofishEnv(opts: { cookiesPath?: string } = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GOOFISH_AUTO_REFRESH_TOKEN: '1',
    GOOFISH_HEADLESS: '1',
    ...(opts.cookiesPath ? { GOOFISH_COOKIES_PATH: opts.cookiesPath } : {}),
  };
}
