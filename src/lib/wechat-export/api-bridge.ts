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
import { isVenvReady, getVenvPythonPath } from '@/lib/python-venv';
import { resolvePythonBinary } from '@/lib/python-runtime';
import { resolveRuntimeResourceRootFor } from '@/lib/runtime-resources';

const TIMEOUT_MS = 30_000;

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

function getPythonBinary(): string | null {
  if (isVenvReady()) return getVenvPythonPath();
  return resolvePythonBinary();
}

export interface ApiBridgeError {
  code: 'no_python' | 'spawn_failed' | 'bad_json' | 'timeout' | 'python_error';
  message: string;
}

export type ApiBridgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiBridgeError };

export async function queryWeChatApi<T = unknown>(
  op: string,
  args: Record<string, unknown> = {},
): Promise<ApiBridgeResult<T>> {
  const py = getPythonBinary();
  if (!py) {
    return { ok: false, error: { code: 'no_python', message: 'No usable Python runtime' } };
  }

  const apiScript = path.join(
    resolveRuntimePath(),
    'mcp-servers',
    'wechat-export',
    'macos',
    'api.py',
  );

  const baseDir = path.join(dataDir, 'wechat-export');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LUMOS_WECHAT_EXPORT_KEY_FILE: path.join(baseDir, 'key.txt'),
    LUMOS_WECHAT_EXPORT_CONTACTS_FILE: path.join(baseDir, 'contacts.json'),
    LUMOS_WECHAT_EXPORT_SQLCIPHER: findSqlcipher(),
  };

  return new Promise<ApiBridgeResult<T>>((resolve) => {
    const child = spawn(py, [apiScript], { env, stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      resolve({ ok: false, error: { code: 'timeout', message: `Python timed out after ${TIMEOUT_MS}ms` } });
    }, TIMEOUT_MS);

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
