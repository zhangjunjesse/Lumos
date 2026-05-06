/**
 * Thin wrapper around the upstream `goofish` CLI binary
 * (https://github.com/fancyboi999/goofish-cli, Apache-2.0).
 *
 * Used by the goofish auth API routes to spawn `goofish auth status`,
 * `goofish auth login`, etc. and parse their JSON output. The MCP launcher
 * has its own copy of the binary-discovery logic in launcher.mjs — kept
 * separate because the launcher must work in a stripped Node child process,
 * while this lib runs inside the Next.js server with full TS support.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildGoofishEnv } from './env';
import { getVenvDir, isVenvReady } from '../python-venv';

const HOME = os.homedir();
const IS_WINDOWS = process.platform === 'win32';

export interface GoofishAuthStatus {
  unb: string;
  tracknick: string;
  nick: string;
  valid: boolean;
}

export interface GoofishCliError {
  code: 'NOT_INSTALLED' | 'EXEC_FAILED' | 'PARSE_FAILED' | 'AUTH_FAILED';
  message: string;
  stderr?: string;
}

export class GoofishCliException extends Error {
  readonly code: GoofishCliError['code'];
  readonly stderr?: string;
  constructor(error: GoofishCliError) {
    super(error.message);
    this.code = error.code;
    this.stderr = error.stderr;
  }
}

/**
 * Locate the `goofish` CLI binary. Returns null if not installed.
 * Probe order matches launcher.mjs to give consistent diagnostics across
 * the two entry points.
 */
function findGoofishBin(): string | null {
  if (process.env.GOOFISH_BIN && existsSync(process.env.GOOFISH_BIN)) {
    return process.env.GOOFISH_BIN;
  }

  // Lumos-managed venv first. The install API (POST /api/goofish/install)
  // writes into this venv, so a successful one-click install shows up here
  // before any user-scoped install.
  //
  // Note: this probe targets the `goofish` CLI binary (used by runJsonCommand
  // to spawn `goofish auth status` etc), while launcher.mjs probes for
  // `goofish-mcp` (the MCP stdio entry point). pip ships both entries from
  // the same goofish-cli package, so either being present implies both are.
  // The two paths intentionally probe different files because each is the
  // executable that path actually needs to spawn.
  if (isVenvReady()) {
    const venvBin = path.join(
      getVenvDir(),
      IS_WINDOWS ? 'Scripts' : 'bin',
      IS_WINDOWS ? 'goofish.exe' : 'goofish',
    );
    if (existsSync(venvBin)) return venvBin;
  }

  const candidates: string[] = [];
  if (IS_WINDOWS) {
    candidates.push('goofish.exe');
    const appdata = process.env.APPDATA;
    if (appdata) {
      for (const v of ['Python313', 'Python312', 'Python311', 'Python310']) {
        candidates.push(path.join(appdata, 'Python', v, 'Scripts', 'goofish.exe'));
      }
    }
  } else {
    candidates.push('goofish');
    candidates.push(path.join(HOME, '.local', 'bin', 'goofish'));
    if (process.platform === 'darwin') {
      for (const v of ['3.13', '3.12', '3.11', '3.10']) {
        candidates.push(path.join(HOME, 'Library', 'Python', v, 'bin', 'goofish'));
      }
    }
  }

  for (const cand of candidates) {
    if (path.isAbsolute(cand)) {
      if (existsSync(cand)) return cand;
      continue;
    }
    // PATH lookup — `command -v` is more reliable than `which` across shells.
    const probe = spawnSync(IS_WINDOWS ? 'where' : 'sh', IS_WINDOWS ? [cand] : ['-c', `command -v ${cand}`], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    });
    if (probe.status === 0) {
      return cand;
    }
  }
  return null;
}

export function isGoofishInstalled(): boolean {
  return findGoofishBin() !== null;
}

/**
 * Run `goofish <args>` and return parsed JSON stdout. Logs from goofish-cli
 * are written to stdout before the JSON payload (loguru → stdout), so we
 * find the first `{` or `[` and parse from there.
 */
export async function runJsonCommand(
  args: string[],
  opts: { timeoutMs?: number; allowAutoRefresh?: boolean; cookiesPath?: string } = {},
): Promise<unknown> {
  const bin = findGoofishBin();
  if (!bin) {
    throw new GoofishCliException({
      code: 'NOT_INSTALLED',
      message: 'goofish CLI is not installed. Run: pip install --user goofish-cli',
    });
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(bin, [...args, '--format', 'json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // buildGoofishEnv default: GOOFISH_AUTO_REFRESH_TOKEN=1 +
      // GOOFISH_HEADLESS=1 — token expiry is auto-recovered without a
      // visible Chrome window. The legacy `allowAutoRefresh` flag is kept
      // for back-compat but no longer controls anything (refresh always on).
      env: buildGoofishEnv({ cookiesPath: opts.cookiesPath }),
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new GoofishCliException({
        code: 'EXEC_FAILED',
        message: `goofish ${args[0]} timed out`,
      }));
    }, opts.timeoutMs ?? 60_000);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new GoofishCliException({
        code: 'EXEC_FAILED',
        message: `failed to spawn goofish: ${err.message}`,
        stderr,
      }));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        // Pull the last meaningful error line out of stderr/stdout so the
        // surfaced message is "FAIL_SYS_TOKEN_EXOIRED" instead of just
        // "exited with code 1". goofish-cli writes Python tracebacks to
        // stderr and the actual error usually appears as the last non-empty
        // line or a `RuntimeError: ...` style line.
        const tail = extractErrorTail(stderr || stdout);
        reject(new GoofishCliException({
          code: 'EXEC_FAILED',
          message: tail ? `goofish ${args[0]} 失败：${tail}` : `goofish ${args[0]} exited with code ${code}`,
          stderr,
        }));
        return;
      }

      // Strip log-prefix noise: goofish-cli's loguru emits `2026-... | INFO | ...` lines
      // before the JSON payload when cookies need a refresh. Find the first JSON token.
      const jsonStart = stdout.search(/[[{]/);
      if (jsonStart < 0) {
        reject(new GoofishCliException({
          code: 'PARSE_FAILED',
          message: `goofish ${args[0]} produced no JSON output`,
          stderr: stdout + '\n---\n' + stderr,
        }));
        return;
      }
      try {
        resolve(JSON.parse(stdout.slice(jsonStart)));
      } catch (parseErr) {
        reject(new GoofishCliException({
          code: 'PARSE_FAILED',
          message: `goofish ${args[0]} returned malformed JSON: ${(parseErr as Error).message}`,
          stderr: stdout + '\n---\n' + stderr,
        }));
      }
    });
  });
}

function extractErrorTail(s: string): string {
  if (!s) return '';
  // Prefer explicit Python error lines (`Error: ...`, `RuntimeError: ...`).
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
  const errLine = [...lines].reverse().find((l) => /^[A-Za-z_]+(Error|Exception):/.test(l));
  if (errLine) return errLine.length > 200 ? errLine.slice(0, 200) + '…' : errLine;
  // Otherwise fall back to last non-loguru line.
  const lastUseful = [...lines].reverse().find((l) => !/^\d{4}-\d{2}-\d{2}.*\| (DEBUG|INFO|WARNING) \|/.test(l));
  if (!lastUseful) return '';
  return lastUseful.length > 200 ? lastUseful.slice(0, 200) + '…' : lastUseful;
}

export function normalizeNick(raw: string | undefined): string {
  if (!raw) return '';
  let s = raw;
  if (s.includes('%')) {
    try { s = decodeURIComponent(s); } catch { /* leave as-is */ }
  }
  if (s.includes('\\u')) {
    try { s = JSON.parse('"' + s.replace(/"/g, '\\"') + '"'); } catch { /* leave as-is */ }
  }
  return s;
}

