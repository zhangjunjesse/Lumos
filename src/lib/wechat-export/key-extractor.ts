/**
 * Drive `extract_key.py` (vendored under resources/mcp-servers/wechat-export/macos/)
 * and stream its progress to a callback.
 *
 * lldb's Python module isn't pip-installable, so we have to point Python at it
 * via PYTHONPATH=$(lldb -P). The script itself does the rest — attach, scan,
 * verify candidates, write `wechat_keys.json` + `key.txt`.
 */
import { spawn } from 'child_process';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ensureFeatureDir, KEY_FILE, KEYS_JSON_FILE } from './setup-state';

const SCRIPT_REL = 'mcp-servers/wechat-export/macos/extract_key.py';

function getRuntimePath(): string {
  // Mirror src/lib/mcp-resolver.ts:resolveRuntimePath
  const isPackaged = !!process.resourcesPath
    && fs.existsSync(path.join(process.resourcesPath, 'mcp-servers'));
  if (isPackaged) return process.resourcesPath;
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
  const runtimePath = getRuntimePath();
  const scriptPath = path.join(runtimePath, SCRIPT_REL);
  if (!fs.existsSync(scriptPath)) {
    return { success: false, keysFound: 0, error: `extract_key.py not found at ${scriptPath}`, log: '' };
  }
  const lldbPy = findLldbPythonPath();
  if (!lldbPy) {
    return {
      success: false,
      keysFound: 0,
      error: 'lldb 未安装。请先运行 `xcode-select --install` 安装 Xcode 命令行工具。',
      log: '',
    };
  }
  const py = findSystemPython3();
  if (!py) {
    return {
      success: false,
      keysFound: 0,
      error: '/usr/bin/python3 未找到 (Xcode 命令行工具未完整安装)',
      log: '',
    };
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PYTHONPATH: lldbPy,
  };

  return new Promise<KeyExtractionResult>((resolve) => {
    const child = spawn(py, [
      scriptPath,
      '--pid', String(pid),
      '--out', KEYS_JSON_FILE,
      '--key-out', KEY_FILE,
    ], { env });

    let stdoutBuf = '';
    let stderrBuf = '';

    const handleLine = (line: string) => {
      if (!line) return;
      if (line.includes('attaching pid')) {
        onProgress?.({ phase: 'starting', message: line });
        return;
      }
      if (line.includes('scanning memory')) {
        onProgress?.({ phase: 'scanning', message: line });
        return;
      }
      const found = line.match(/\[FOUND\]\s+salt=([0-9a-f]+)\s+key=([0-9a-f]+)/);
      if (found) {
        onProgress?.({ phase: 'found', message: line });
        return;
      }
      const summary = line.match(/scanned\s+(\d+)\s+regions/);
      if (summary) {
        onProgress?.({ phase: 'scanning', message: line });
        return;
      }
      if (line.startsWith('[+] wrote') || line.startsWith('[+] message_*.db key')) {
        onProgress?.({ phase: 'done', message: line });
      }
    };

    const flush = (buf: string, append: (chunk: string) => void): string => {
      const lines = buf.split(/\r?\n/);
      const tail = lines.pop() ?? '';
      for (const line of lines) {
        append(line);
        handleLine(line.trim());
      }
      return tail;
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      stdoutBuf = flush(stdoutBuf, () => { /* keep buf */ });
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
      stderrBuf = flush(stderrBuf, () => { /* keep buf */ });
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        keysFound: 0,
        error: `进程启动失败: ${err.message}`,
        log: stdoutBuf + stderrBuf,
      });
    });

    child.on('close', (code) => {
      const log = stdoutBuf + stderrBuf;
      if (code !== 0) {
        onProgress?.({
          phase: 'error',
          message: `extract_key.py 退出 (code ${code})`,
        });
        resolve({
          success: false,
          keysFound: 0,
          error: `extract_key.py 退出 code ${code}`,
          log,
        });
        return;
      }
      let keysFound = 0;
      try {
        if (fs.existsSync(KEYS_JSON_FILE)) {
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
