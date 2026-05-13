/**
 * Drive the platform-specific `extract_key.py` and stream progress to the UI.
 *
 * macOS uses lldb's Python module via PYTHONPATH=$(lldb -P). Windows uses the
 * Lumos managed Python runtime and reads WeChat.exe with Win32 APIs.
 */
import { spawn } from 'child_process';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getVenvPythonPath, isVenvReady } from '@/lib/python-venv';
import { resolvePythonBinary } from '@/lib/python-runtime';
import { resolveRuntimeResourceRootFor } from '@/lib/runtime-resources';
import {
  ensureFeatureDir,
  getWeChatExportPlatform,
  KEY_FILE,
  KEYS_JSON_FILE,
  readWindowsPathConfig,
  WINDOWS_ACCOUNTS_FILE,
  type WeChatExportPlatform,
} from './setup-state';
import { getWindowsWeChatProcessNames } from './env-check';

const SCRIPT_REL_BY_PLATFORM: Record<WeChatExportPlatform, string> = {
  darwin: 'mcp-servers/wechat-export/macos/extract_key.py',
  win32: 'mcp-servers/wechat-export/windows/extract_key.py',
};

function getRuntimePath(): string {
  const resolved = resolveRuntimeResourceRootFor('mcp-servers');
  if (resolved) return resolved;
  return path.join(process.cwd(), 'resources');
}

function findLldbPythonPath(): string | null {
  try {
    return execFileSync('/usr/bin/lldb', ['-P'], { encoding: 'utf8', timeout: 5000 }).trim() || null;
  } catch {
    return null;
  }
}

function findSystemPython3(): string | null {
  // System Python 3 ships with macOS via Xcode CLT — that's also where lldb's
  // Python module is built against, so we use /usr/bin/python3 here rather
  // than the user's anaconda / pyenv to avoid ABI mismatches.
  if (fs.existsSync('/usr/bin/python3')) return '/usr/bin/python3';
  return null;
}

function findManagedPython(): string | null {
  if (isVenvReady()) return getVenvPythonPath();
  return resolvePythonBinary({ minimumVersion: { major: 3, minor: 10 } });
}

export interface KeyExtractionProgress {
  phase: 'starting' | 'scanning' | 'found' | 'done' | 'error';
  message: string;
  /** Recovered keys so far. */
  keysFound?: number;
  /** Total expected (number of unique salts in db_storage). */
  saltsTotal?: number;
}

export interface KeyExtractionResult {
  success: boolean;
  keysFound: number;
  /** Path to wechat_keys.json, when success. */
  keysJsonPath?: string;
  /** Path to key.txt (the message_*.db key), when success. */
  keyTxtPath?: string;
  /** Last error message when success=false. */
  error?: string;
  /** Full extraction log. */
  log: string;
}

function redactKeyMaterial(line: string): string {
  return line.replace(/\bkey=([0-9a-fA-F]{64})\b/g, 'key=<redacted>');
}

function extractPythonError(log: string): string | null {
  const lines = log.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.reverse()) {
    const match = line.match(/^\[ERROR\]\s*(.+)$/);
    if (match?.[1]) return match[1].trim();
    if (/^(RuntimeError|FileNotFoundError|PermissionError):/.test(line)) return line;
  }
  return null;
}

/**
 * Run the extractor. `onProgress` fires for every line of stdout/stderr we can
 * classify; the wizard uses it to drive the SSE channel. Returns the final
 * result once the subprocess exits.
 */
export async function extractKeys(
  pid: number,
  onProgress?: (p: KeyExtractionProgress) => void,
): Promise<KeyExtractionResult> {
  ensureFeatureDir();
  const platform = getWeChatExportPlatform();
  if (!platform) {
    return { success: false, keysFound: 0, error: `当前平台不支持微信读取: ${process.platform}`, log: '' };
  }
  const runtimePath = getRuntimePath();
  const scriptPath = path.join(runtimePath, SCRIPT_REL_BY_PLATFORM[platform]);
  if (!fs.existsSync(scriptPath)) {
    return { success: false, keysFound: 0, error: `extract_key.py not found at ${scriptPath}`, log: '' };
  }
  let py: string | null = null;
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.PYTHONIOENCODING = 'utf-8:backslashreplace';
  env.PYTHONUTF8 = '1';
  env.PYTHONUNBUFFERED = '1';
  const args = [scriptPath, '--pid', String(pid)];

  if (platform === 'darwin') {
    const lldbPy = findLldbPythonPath();
    if (!lldbPy) {
      return {
        success: false,
        keysFound: 0,
        error: 'lldb 未安装。请先运行 `xcode-select --install` 安装 Xcode 命令行工具。',
        log: '',
      };
    }
    py = findSystemPython3();
    if (!py) {
      return {
        success: false,
        keysFound: 0,
        error: '/usr/bin/python3 未找到 (Xcode 命令行工具未完整安装)',
        log: '',
      };
    }
    env.PYTHONPATH = lldbPy;
    args.push('--out', KEYS_JSON_FILE, '--key-out', KEY_FILE);
  } else {
    py = findManagedPython();
    if (!py) {
      return {
        success: false,
        keysFound: 0,
        error: '未找到可用 Python 运行时。',
        log: '',
      };
    }
    const windowsConfig = readWindowsPathConfig();
    if (windowsConfig.wechatDataRoot) {
      env.LUMOS_WECHAT_EXPORT_WINDOWS_DATA_ROOTS = windowsConfig.wechatDataRoot;
    }
    env.LUMOS_WECHAT_EXPORT_WINDOWS_PROCESS_NAMES = getWindowsWeChatProcessNames().join(';');
    args.push('--accounts-out', WINDOWS_ACCOUNTS_FILE, '--key-out', KEY_FILE);
  }

  return new Promise<KeyExtractionResult>((resolve) => {
    const child = spawn(py, args, { env });

    let stdoutBuf = '';
    let stderrBuf = '';
    let extractionLog = '';

    const handleLine = (line: string) => {
      if (!line) return;
      const safeLine = redactKeyMaterial(line);
      if (line.includes('attaching pid')) {
        onProgress?.({ phase: 'starting', message: safeLine });
        return;
      }
      if (
        line.includes('scanning memory')
        || line.includes('scanning WeChatWin.dll')
        || line.includes('scanning module')
        || line.includes('scanning candidate pointers')
        || line.includes('key scan modules=')
      ) {
        onProgress?.({ phase: 'scanning', message: safeLine });
        return;
      }
      const found = line.match(/\[FOUND\]\s+(?:salt=([0-9a-f]+)\s+)?(?:wxid=([\w@.\-]+)\s+)?(?:key=(?:[0-9a-f]+|\*+|<redacted>)\s*)?/);
      if (found) {
        onProgress?.({ phase: 'found', message: safeLine });
        return;
      }
      const summary = line.match(/scanned\s+(\d+)\s+regions/);
      if (summary) {
        onProgress?.({ phase: 'scanning', message: safeLine });
        return;
      }
      if (line.startsWith('[+] wrote') || line.startsWith('[+] message_*.db key')) {
        onProgress?.({ phase: 'done', message: safeLine });
      }
    };

    const flush = (buf: string): string => {
      const lines = buf.split(/\r?\n/);
      const tail = lines.pop() ?? '';
      for (const line of lines) {
        extractionLog += `${redactKeyMaterial(line)}\n`;
        handleLine(line.trim());
      }
      return tail;
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      stdoutBuf = flush(stdoutBuf);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
      stderrBuf = flush(stderrBuf);
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        keysFound: 0,
        error: `进程启动失败: ${err.message}`,
        log: extractionLog + redactKeyMaterial(stdoutBuf + stderrBuf),
      });
    });

    child.on('close', (code) => {
      const log = extractionLog + redactKeyMaterial(stdoutBuf + stderrBuf);
      if (code !== 0) {
        const message = extractPythonError(log) || `extract_key.py 退出 code ${code}`;
        onProgress?.({
          phase: 'error',
          message,
        });
        resolve({
          success: false,
          keysFound: 0,
          error: message,
          log,
        });
        return;
      }
      let keysFound = 0;
      try {
        if (platform === 'win32' && fs.existsSync(WINDOWS_ACCOUNTS_FILE)) {
          const accounts = JSON.parse(fs.readFileSync(WINDOWS_ACCOUNTS_FILE, 'utf8')) as Array<{ key?: string; keys?: Record<string, string> }>;
          const keys = new Set<string>();
          for (const account of accounts) {
            if (/^[0-9a-fA-F]{64}$/.test(account.key || '')) keys.add(account.key || '');
            if (account.keys && typeof account.keys === 'object') {
              for (const value of Object.values(account.keys)) {
                if (/^[0-9a-fA-F]{64}$/.test(value || '')) keys.add(value);
              }
            }
          }
          keysFound = keys.size;
        } else if (fs.existsSync(KEYS_JSON_FILE)) {
          const map = JSON.parse(fs.readFileSync(KEYS_JSON_FILE, 'utf8')) as Record<string, string>;
          keysFound = Object.keys(map).length;
        }
      } catch { /* ignore */ }
      resolve({
        success: keysFound > 0,
        keysFound,
        keysJsonPath: KEYS_JSON_FILE,
        keyTxtPath: KEY_FILE,
        log,
      });
    });
  });
}
