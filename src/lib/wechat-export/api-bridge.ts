/**
 * Bridge between Next.js routes and the vendored Python `api.py` helper.
 *
 * Each call spawns a fresh Python process, pipes a JSON op/args to stdin,
 * and reads one JSON object back from stdout. The first call decrypts the
 * contact.db and writes contacts.json; subsequent cold starts hit that
 * file directly (~50ms).
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { dataDir } from '@/lib/db';
import { resolveRuntimeResourceRootFor } from '@/lib/runtime-resources';
import { getWeChatExportPlatform, WINDOWS_ACCOUNTS_FILE, WINDOWS_DECRYPT_DIR } from './setup-state';
import { ensureWeChatExportPythonEnv } from '@/lib/wechat-export/python-env';

const TIMEOUT_MS = 30_000;
const WINDOWS_TIMEOUT_MS = 60_000;

const SQLCIPHER_CANDIDATES = [
  '/opt/homebrew/opt/sqlcipher/bin/sqlcipher',
  '/usr/local/opt/sqlcipher/bin/sqlcipher',
  '/opt/homebrew/bin/sqlcipher',
  '/usr/local/bin/sqlcipher',
];

function findSqlcipher(): string {
  // Mirror the enricher's lookup so api.py sees the same binary the MCP does.
  for (const candidate of SQLCIPHER_CANDIDATES) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch { /* keep scanning */ }
  }
  return 'sqlcipher';
}

function resolveRuntimePath(): string {
  return resolveRuntimeResourceRootFor('mcp-servers')
    || resolveRuntimeResourceRootFor('feishu-mcp-server')
    || path.join(process.cwd(), 'resources');
}

export interface ApiBridgeError {
  code: 'no_python' | 'spawn_failed' | 'bad_json' | 'timeout' | 'python_error';
  message: string;
}

export type ApiBridgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiBridgeError };

export interface QueryWeChatApiOptions {
  timeoutMs?: number;
}

export async function queryWeChatApi<T = unknown>(
  op: string,
  args: Record<string, unknown> = {},
  options: QueryWeChatApiOptions = {},
): Promise<ApiBridgeResult<T>> {
  let py: string;
  try {
    py = await ensureWeChatExportPythonEnv();
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'no_python',
        message: `WeChat Python runtime not ready: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }

  const platform = getWeChatExportPlatform();
  if (!platform) {
    return {
      ok: false,
      error: { code: 'python_error', message: `Unsupported platform: ${process.platform}` },
    };
  }

  const apiScript = path.join(
    resolveRuntimePath(),
    'mcp-servers',
    'wechat-export',
    platform === 'win32' ? 'windows' : 'macos',
    'api.py',
  );
  if (!fs.existsSync(apiScript)) {
    return {
      ok: false,
      error: { code: 'python_error', message: `api.py not found at ${apiScript}` },
    };
  }

  const baseDir = path.join(dataDir, 'wechat-export');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LUMOS_WECHAT_EXPORT_PLATFORM: platform,
    LUMOS_WECHAT_EXPORT_KEY_FILE: path.join(baseDir, 'key.txt'),
    LUMOS_WECHAT_EXPORT_CONTACTS_FILE: path.join(baseDir, 'contacts.json'),
    LUMOS_WECHAT_EXPORT_SQLCIPHER: findSqlcipher(),
    LUMOS_WECHAT_EXPORT_WINDOWS_ACCOUNTS_FILE: WINDOWS_ACCOUNTS_FILE,
    LUMOS_WECHAT_EXPORT_WINDOWS_DECRYPT_DIR: WINDOWS_DECRYPT_DIR,
    PYTHONIOENCODING: 'utf-8:backslashreplace',
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
  };
  const timeoutMs = options.timeoutMs ?? (platform === 'win32' ? WINDOWS_TIMEOUT_MS : TIMEOUT_MS);

  return new Promise<ApiBridgeResult<T>>((resolve) => {
    const child = spawn(py, [apiScript], { env, stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ ok: false, error: { code: 'timeout', message: `Python timed out after ${timeoutMs}ms` } });
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: { code: 'spawn_failed', message: err.message } });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ ok: false, error: { code: 'python_error', message: stderr.trim() || `Exit code ${code}` } });
        return;
      }
      try {
        resolve({ ok: true, data: JSON.parse(stdout) as T });
      } catch (err) {
        resolve({
          ok: false,
          error: { code: 'bad_json', message: err instanceof Error ? err.message : String(err) },
        });
      }
    });

    child.stdin.write(JSON.stringify({ op, args }));
    child.stdin.end();
  });
}

export interface StreamWeChatApiOptions {
  timeoutMs?: number;
  /** Called for each parsed JSON line on stdout. Throwing aborts the stream. */
  onLine: (record: unknown) => void;
  /** Optional stderr line callback (defaults to console.error). */
  onStderr?: (line: string) => void;
  /** Optional abort signal — kills the child process when triggered. */
  signal?: AbortSignal;
}

/**
 * Spawn api.py in streaming mode (NDJSON on stdout). Each newline-terminated
 * JSON object is delivered to `onLine` as soon as it lands, so callers can
 * sink large result sets directly to disk without buffering everything.
 */
export async function streamWeChatApi(
  op: string,
  args: Record<string, unknown>,
  options: StreamWeChatApiOptions,
): Promise<ApiBridgeResult<{ messagesSeen: number }>> {
  let py: string;
  try {
    py = await ensureWeChatExportPythonEnv();
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'no_python',
        message: `WeChat Python runtime not ready: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }

  const platform = getWeChatExportPlatform();
  if (!platform) {
    return {
      ok: false,
      error: { code: 'python_error', message: `Unsupported platform: ${process.platform}` },
    };
  }

  const apiScript = path.join(
    resolveRuntimePath(),
    'mcp-servers',
    'wechat-export',
    platform === 'win32' ? 'windows' : 'macos',
    'api.py',
  );
  if (!fs.existsSync(apiScript)) {
    return {
      ok: false,
      error: { code: 'python_error', message: `api.py not found at ${apiScript}` },
    };
  }

  const baseDir = path.join(dataDir, 'wechat-export');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LUMOS_WECHAT_EXPORT_PLATFORM: platform,
    LUMOS_WECHAT_EXPORT_KEY_FILE: path.join(baseDir, 'key.txt'),
    LUMOS_WECHAT_EXPORT_CONTACTS_FILE: path.join(baseDir, 'contacts.json'),
    LUMOS_WECHAT_EXPORT_SQLCIPHER: findSqlcipher(),
    LUMOS_WECHAT_EXPORT_WINDOWS_ACCOUNTS_FILE: WINDOWS_ACCOUNTS_FILE,
    LUMOS_WECHAT_EXPORT_WINDOWS_DECRYPT_DIR: WINDOWS_DECRYPT_DIR,
    PYTHONIOENCODING: 'utf-8:backslashreplace',
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
  };

  const timeoutMs = options.timeoutMs ?? (platform === 'win32' ? 10 * 60 * 1000 : 30 * 60 * 1000);
  const onStderr = options.onStderr ?? ((line) => process.stderr.write(`[wechat-api] ${line}\n`));

  return new Promise((resolve) => {
    const child = spawn(py, [apiScript], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    let lineCount = 0;
    let stderrTail = '';
    let stdoutBuf = '';
    let stderrBuf = '';
    let onLineError: Error | null = null;

    const finalize = (result: ApiBridgeResult<{ messagesSeen: number }>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGKILL'); } catch { /* noop */ }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finalize({ ok: false, error: { code: 'timeout', message: `Python timed out after ${timeoutMs}ms` } });
    }, timeoutMs);

    if (options.signal) {
      const onAbort = () => finalize({ ok: false, error: { code: 'spawn_failed', message: 'aborted' } });
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      let newlineIdx = stdoutBuf.indexOf('\n');
      while (newlineIdx !== -1) {
        const line = stdoutBuf.slice(0, newlineIdx).trim();
        stdoutBuf = stdoutBuf.slice(newlineIdx + 1);
        if (line) {
          try {
            const parsed = JSON.parse(line);
            options.onLine(parsed);
            lineCount += 1;
          } catch (err) {
            onLineError = err instanceof Error ? err : new Error(String(err));
            finalize({
              ok: false,
              error: { code: 'bad_json', message: onLineError.message },
            });
            return;
          }
        }
        newlineIdx = stdoutBuf.indexOf('\n');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
      let newlineIdx = stderrBuf.indexOf('\n');
      while (newlineIdx !== -1) {
        const line = stderrBuf.slice(0, newlineIdx);
        stderrBuf = stderrBuf.slice(newlineIdx + 1);
        if (line) {
          stderrTail = line;
          onStderr(line);
        }
        newlineIdx = stderrBuf.indexOf('\n');
      }
    });

    child.on('error', (err) => {
      finalize({ ok: false, error: { code: 'spawn_failed', message: err.message } });
    });

    child.on('close', (code) => {
      if (settled) return;
      // flush any trailing stdout line
      if (stdoutBuf.trim()) {
        try {
          options.onLine(JSON.parse(stdoutBuf.trim()));
          lineCount += 1;
        } catch { /* ignore trailing partial */ }
      }
      if (code !== 0) {
        finalize({
          ok: false,
          error: { code: 'python_error', message: stderrTail || `Exit code ${code}` },
        });
        return;
      }
      finalize({ ok: true, data: { messagesSeen: lineCount } });
    });

    child.stdin.write(JSON.stringify({ op, args }));
    child.stdin.end();
  });
}
