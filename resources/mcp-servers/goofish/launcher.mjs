#!/usr/bin/env node
/**
 * goofish MCP launcher
 *
 * Bridges Lumos's MCP runtime to the upstream goofish-cli's `goofish-mcp`
 * stdio server. The upstream package is `goofish-cli` on PyPI (Apache-2.0,
 * https://github.com/fancyboi999/goofish-cli) — installed via
 * `pip install --user goofish-cli`.
 *
 * --- IMPORTANT: Lumos does NOT use Playwright for the goofish data path. ---
 *
 * It's tempting to read this file and assume goofish needs a heavy browser
 * stack. It does not. Lumos has already redirected the load-bearing surfaces
 * away from the upstream's Playwright-based tools:
 *
 *   - 商品搜索 → src/lib/goofish/browser-search.ts uses Lumos's own
 *     BrowserManager + browser bridge (same one DeepSearch / Zhihu /
 *     Xiaohongshu use). NO Playwright.
 *   - 会话/历史抓取 → chats_fat.py / history_fat.py talk mtop HTTP +
 *     WebSocket directly, only borrowing goofish_cli.core.{session,ws,token,
 *     sign,mtop} as a Python signing/auth library. NO browser, headed or
 *     headless.
 *   - 系统浏览器登录态导入 → goofish-cli's `_pull_from_browser` uses
 *     browser_cookie3 to read existing Chrome/Edge cookies. NO Playwright.
 *
 * Where Playwright is still touched (and why it's not on the critical path):
 *   - qr_login_fat.py opens a headful Chromium so the user can scan the
 *     goofish QR. Optional: the panel also offers "browser auto-import" and
 *     "paste cookie", both of which skip Playwright entirely.
 *   - goofish-cli's internal `auth refresh` (gated by GOOFISH_AUTO_REFRESH_TOKEN
 *     +GOOFISH_HEADLESS) can fall back to a headless Chromium to refresh
 *     `_m_h5_tk`. In practice this rarely fires because mtop pushes a fresh
 *     `_m_h5_tk` on most signed calls.
 *
 * So a "real" install can ship goofish-cli (PyPI deps only, ~20MB) and skip
 * Playwright + the ~150MB Chromium download until the user actually picks
 * QR mode. Don't lump them together.
 *
 * Why a Node launcher instead of pointing `command` directly at the python
 * binary or the `goofish-mcp` script:
 *   - Lumos's `[PYTHON_PATH]` placeholder resolves to the bundled venv, which
 *     does NOT have goofish-cli installed (it's a user-scoped install).
 *   - The `goofish-mcp` script has a hard-coded shebang to whatever python
 *     was active at install time (anaconda / homebrew / system) — that path
 *     may not exist on every user machine, especially after updates.
 *   - We need a probe order: PATH → user-bin → site-packages module-mode →
 *     helpful error message that the GoofishPanel can surface.
 *
 * Behaviour:
 *   1. Probe locations until we find a working invocation.
 *   2. spawn the child with stdio: 'inherit' so JSON-RPC flows through
 *      verbatim. The MCP client (Lumos's Claude SDK runtime) talks to the
 *      child as if we weren't here.
 *   3. Forward signals so the child dies cleanly when Lumos shuts down.
 *   4. On not-installed, exit with a structured error on stderr so the
 *      panel UI can detect it and offer an "Install" button.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const HOME = os.homedir();
const IS_WINDOWS = process.platform === 'win32';

/**
 * Candidate invocations to try, in order.
 * Each candidate is an array: [command, ...args] — the same shape spawn() takes.
 */
function buildCandidates() {
  const candidates = [];

  // 1. User override via env
  if (process.env.GOOFISH_MCP_BIN) {
    candidates.push([process.env.GOOFISH_MCP_BIN]);
  }
  if (process.env.GOOFISH_PYTHON) {
    candidates.push([process.env.GOOFISH_PYTHON, '-m', 'goofish_cli.mcp_server']);
  }

  // 2. Lumos-managed venv at ~/.lumos/python-venv. The GoofishPanel "一键安装"
  //    button POSTs /api/goofish/install which runs `pip install goofish-cli`
  //    into this venv. Probing it BEFORE PATH means the bundled flow always
  //    wins over a stale system install.
  const lumosData = process.env.LUMOS_DATA_DIR || path.join(HOME, '.lumos');
  const venvBinDir = path.join(lumosData, 'python-venv', IS_WINDOWS ? 'Scripts' : 'bin');
  candidates.push([path.join(venvBinDir, IS_WINDOWS ? 'goofish-mcp.exe' : 'goofish-mcp')]);
  candidates.push([
    path.join(venvBinDir, IS_WINDOWS ? 'python.exe' : 'python3'),
    '-m', 'goofish_cli.mcp_server',
  ]);

  // 3. `goofish-mcp` directly on PATH
  candidates.push([IS_WINDOWS ? 'goofish-mcp.exe' : 'goofish-mcp']);

  // 4. pip user-install bin dirs
  if (IS_WINDOWS) {
    // Windows pip --user puts scripts under %APPDATA%\Python\Python3X\Scripts
    const appdata = process.env.APPDATA;
    if (appdata) {
      // best-effort glob-ish: try a few likely python versions
      for (const v of ['Python313', 'Python312', 'Python311', 'Python310']) {
        candidates.push([path.join(appdata, 'Python', v, 'Scripts', 'goofish-mcp.exe')]);
      }
    }
  } else {
    // macOS / Linux: pip --user typically targets ~/.local/bin OR
    // ~/Library/Python/3.X/bin on macOS system python.
    candidates.push([path.join(HOME, '.local', 'bin', 'goofish-mcp')]);
    if (process.platform === 'darwin') {
      for (const v of ['3.13', '3.12', '3.11', '3.10']) {
        candidates.push([path.join(HOME, 'Library', 'Python', v, 'bin', 'goofish-mcp')]);
      }
    }
  }

  // 5. As a last resort, ask any python on PATH to load the module. Useful
  //    if the user installed the package but the script entry is broken
  //    (mismatched shebang etc).
  candidates.push(['python3', '-m', 'goofish_cli.mcp_server']);
  candidates.push(['python', '-m', 'goofish_cli.mcp_server']);

  return candidates;
}

function probe(cmd) {
  const exe = cmd[0];

  // For absolute paths: just check existence + executable bit.
  if (path.isAbsolute(exe)) {
    return existsSync(exe) ? cmd : null;
  }

  // For PATH lookups: spawnSync `which` is overkill and unreliable across
  // shells. We use `command -v` (POSIX) or `where` (Windows). Failure → not found.
  const probeRes = spawnSync(
    IS_WINDOWS ? 'where' : 'sh',
    IS_WINDOWS ? [exe] : ['-c', `command -v ${exe}`],
    { stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 },
  );
  return probeRes.status === 0 ? cmd : null;
}

function pickInvocation() {
  const candidates = buildCandidates();
  for (const cand of candidates) {
    const ok = probe(cand);
    if (ok) return ok;
  }
  return null;
}

function emitNotInstalled() {
  const msg = [
    '[goofish-mcp] goofish-cli is not installed in any expected location.',
    '',
    'Install with:  pip install --user goofish-cli',
    'Or:            python3 -m pip install --user goofish-cli',
    '',
    'After install, restart Lumos. If goofish-cli is installed but the launcher',
    "can't find it, set GOOFISH_MCP_BIN to the absolute path of `goofish-mcp`.",
  ].join('\n');
  process.stderr.write(msg + '\n');
  process.exit(127);
}

/**
 * Pick a cookies.json path for the upstream goofish-mcp.
 *
 * Lumos's multi-account layout puts cookies under
 * `~/.lumos/goofish-accounts/<unb>/.goofish-cli/cookies.json` — the upstream
 * MCP is single-account, so we pick the FIRST valid account directory and
 * point goofish-cli at it via GOOFISH_COOKIES_PATH.
 *
 * Caveat: the AI only sees that one account through the upstream tools.
 * For multi-account queries it should use our goofish-search MCP (which
 * accepts an `account` parameter and goes through Lumos's account-aware DB).
 */
function pickAccountCookiesPath() {
  if (process.env.GOOFISH_COOKIES_PATH) return process.env.GOOFISH_COOKIES_PATH;
  const lumosData = process.env.LUMOS_DATA_DIR
    || path.join(os.homedir(), '.lumos');
  const accountsRoot = path.join(lumosData, 'goofish-accounts');
  try {
    if (!existsSync(accountsRoot)) return null;
    for (const name of readdirSync(accountsRoot)) {
      if (!/^\d+$/.test(name)) continue;
      const cookiesPath = path.join(accountsRoot, name, '.goofish-cli', 'cookies.json');
      if (existsSync(cookiesPath)) return cookiesPath;
    }
  } catch { /* ignore */ }
  return null;
}

function main() {
  const invocation = pickInvocation();
  if (!invocation) {
    emitNotInstalled();
    return;
  }

  const cookiesPath = pickAccountCookiesPath();

  const [exe, ...args] = invocation;
  const child = spawn(exe, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Token auto-refresh is on, in HEADLESS mode — goofish-cli pops up an
      // invisible Chrome via Playwright to refresh the 10-min `_m_h5_tk`
      // cookie. Without this, AI tool calls fail with "session expired"
      // until the user manually re-logs in. Tested OK: `auth status`
      // succeeds in headless mode.
      GOOFISH_AUTO_REFRESH_TOKEN: '1',
      GOOFISH_HEADLESS: '1',
      // Point upstream goofish-mcp at the active Lumos account's cookies.
      ...(cookiesPath ? { GOOFISH_COOKIES_PATH: cookiesPath } : {}),
    },
  });

  const forwardSignal = (sig) => {
    if (child && !child.killed) {
      child.kill(sig);
    }
  };
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => process.on(sig, () => forwardSignal(sig)));

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
  child.on('error', (err) => {
    process.stderr.write(`[goofish-mcp] failed to spawn ${exe}: ${err.message}\n`);
    process.exit(126);
  });
}

main();
