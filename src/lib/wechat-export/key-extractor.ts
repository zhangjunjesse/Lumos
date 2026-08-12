/**
 * Drive the platform-specific `extract_key.py` and stream progress to the UI.
 *
 * macOS uses lldb's Python module via PYTHONPATH=$(lldb -P). Windows uses the
 * Lumos managed Python runtime and reads WeChat/Weixin processes with Win32 APIs.
 */
import { spawn } from 'child_process';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getVenvPythonPath, isVenvReady } from '@/lib/python-venv';
import { resolvePythonBinary } from '@/lib/python-runtime';
import { resolveRuntimeResourceRootFor } from '@/lib/runtime-resources';
import { bindAccountFromExtraction, readBoundAccount } from './active-account';
import {
  ensureFeatureDir,
  getWeChatExportPlatform,
  KEY_FILE,
  KEYS_JSON_FILE,
  readWindowsPathConfig,
  SETUP_LOG_FILE,
  WINDOWS_ACCOUNTS_FILE,
  type WeChatExportPlatform,
} from './setup-state';
import { getWindowsWeChatProcessNames, getWindowsWeChatRootCandidates, probeWindowsWeChatDataDir } from './env-check';

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
  /** Path to the persisted redacted extraction log, when available. */
  logPath?: string;
}

export interface KeyExtractionOptions {
  signal?: AbortSignal;
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
 * 数一下盘上现有多少把密钥。用于「扫描被超时终止,但脚本已经增量落盘」这种情况 ——
 * 部分成功远好过一无所有,不该报成纯失败让用户从头再扫一次。
 */
function countRecoveredKeys(platform: WeChatExportPlatform): number {
  const isHex = (v: unknown) => typeof v === 'string' && /^[0-9a-fA-F]{64}$/.test(v);
  try {
    if (platform === 'win32') {
      if (!fs.existsSync(WINDOWS_ACCOUNTS_FILE)) return 0;
      const accounts = JSON.parse(fs.readFileSync(WINDOWS_ACCOUNTS_FILE, 'utf8')) as Array<{
        key?: string; keys?: Record<string, string>;
      }>;
      const keys = new Set<string>();
      for (const a of accounts) {
        if (isHex(a.key)) keys.add(a.key!);
        for (const v of Object.values(a.keys || {})) if (isHex(v)) keys.add(v);
      }
      return keys.size;
    }
    if (!fs.existsSync(KEYS_JSON_FILE)) return 0;
    const map = JSON.parse(fs.readFileSync(KEYS_JSON_FILE, 'utf8')) as Record<string, string>;
    return Object.values(map).filter(isHex).length;
  } catch {
    return 0;
  }
}

function beginExtractionLog(): { path?: string; append: (text: string) => void } {
  try {
    ensureFeatureDir();
    const header = [
      '',
      `===== ${new Date().toISOString()} wechat-export extract-key =====`,
    ].join('\n');
    fs.appendFileSync(SETUP_LOG_FILE, `${header}\n`, { encoding: 'utf8', mode: 0o600 });
    return {
      path: SETUP_LOG_FILE,
      append: (text: string) => {
        fs.appendFileSync(SETUP_LOG_FILE, text, { encoding: 'utf8', mode: 0o600 });
      },
    };
  } catch {
    return { append: () => undefined };
  }
}

/**
 * Run the extractor. `onProgress` fires for every line of stdout/stderr we can
 * classify; the wizard uses it to drive the SSE channel. Returns the final
 * result once the subprocess exits.
 */
export async function extractKeys(
  pid: number,
  onProgress?: (p: KeyExtractionProgress) => void,
  options: KeyExtractionOptions = {},
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
    // #40:把"当前活跃账号"和所有候选数据根都告诉 Python(不再只传手动配置)。
    // 之前 probe 挑对了当前账号,extract 却没用上——Python 自己猜,切账号后拿旧账号库
    // 验新密钥验不过就卡死不写盘。给全候选(当前活跃账号排最前),让 Python 用密钥逐个匹配、
    // 写它真正能解开的那个账号。
    const windowsConfig = readWindowsPathConfig();
    const dataRoots: string[] = [];
    if (windowsConfig.wechatDataRoot) dataRoots.push(windowsConfig.wechatDataRoot);
    // 用户绑定过账号就以它为准,不用 mtime 猜的那个。猜错的代价很实在:Python 会
    // 照着错账号的库反复验证密钥、永远验不过,一路卡到 30 分钟硬超时被杀。
    const bound = readBoundAccount()?.wxid;
    if (bound) env.LUMOS_WECHAT_EXPORT_WINDOWS_ACTIVE_WXID = bound;
    try {
      const probe = probeWindowsWeChatDataDir();
      if (probe.ok && probe.root) dataRoots.push(probe.root);
      // 没有绑定时才退回猜测,并且只用于日志标注"预期目标账号"。
      if (!bound && probe.ok && probe.wxid) env.LUMOS_WECHAT_EXPORT_WINDOWS_ACTIVE_WXID = probe.wxid;
    } catch { /* probe 失败不影响取密钥 */ }
    for (const root of getWindowsWeChatRootCandidates()) dataRoots.push(root);
    const uniqueRoots = [...new Set(dataRoots.filter(Boolean))];
    if (uniqueRoots.length > 0) {
      env.LUMOS_WECHAT_EXPORT_WINDOWS_DATA_ROOTS = uniqueRoots.join(';');
    }
    env.LUMOS_WECHAT_EXPORT_WINDOWS_PROCESS_NAMES = getWindowsWeChatProcessNames().join(';');
    args.push('--accounts-out', WINDOWS_ACCOUNTS_FILE, '--key-out', KEY_FILE);
  }

  return new Promise<KeyExtractionResult>((resolve) => {
    const liveLog = beginExtractionLog();
    const child = spawn(py, args, { env });

    let stdoutBuf = '';
    let stderrBuf = '';
    let extractionLog = '';
    let settled = false;
    let aborted = false;

    // 硬超时:取密钥正常 5-15 分钟。超过 30 分钟必是卡死(如切账号后拿错账号库反复验证
    // 密钥不写盘)。之前无超时 → 会转一整天;这里到点终止并给明确指引,别让用户干等。
    const EXTRACT_TIMEOUT_MS = 30 * 60 * 1000;
    let timedOut = false;
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      liveLog.append(`[TIMEOUT] 取密钥超过 ${EXTRACT_TIMEOUT_MS / 60000} 分钟仍未完成,终止。\n`);
      try { child.kill(); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 2000).unref?.();
    }, EXTRACT_TIMEOUT_MS);
    timeoutTimer.unref?.();

    const finish = (result: KeyExtractionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (options.signal) options.signal.removeEventListener('abort', abortChild);
      resolve(result);
    };

    const appendLogLine = (line: string) => {
      const safe = redactKeyMaterial(line);
      extractionLog += `${safe}\n`;
      liveLog.append(`${safe}\n`);
    };

    const abortChild = () => {
      aborted = true;
      liveLog.append('[CANCEL] extraction request aborted; terminating extract_key.py\n');
      try { child.kill(); } catch { /* ignore */ }
      const killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }, 2000);
      killTimer.unref?.();
    };
    if (options.signal?.aborted) {
      abortChild();
    } else if (options.signal) {
      options.signal.addEventListener('abort', abortChild, { once: true });
    }

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
        || line.includes('v4 raw heap')
        || line.includes('v4 heap progress')
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
        appendLogLine(line);
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
      liveLog.append(`[ERROR] process start failed: ${redactKeyMaterial(err.message)}\n`);
      finish({
        success: false,
        keysFound: 0,
        error: `进程启动失败: ${err.message}`,
        log: extractionLog + redactKeyMaterial(stdoutBuf + stderrBuf),
        logPath: liveLog.path,
      });
    });

    child.on('close', (code) => {
      const log = extractionLog + redactKeyMaterial(stdoutBuf + stderrBuf);
      if (stdoutBuf) {
        liveLog.append(redactKeyMaterial(stdoutBuf));
        stdoutBuf = '';
      }
      if (stderrBuf) {
        liveLog.append(redactKeyMaterial(stderrBuf));
        stderrBuf = '';
      }
      const logPath = liveLog.path;
      if (timedOut) {
        // 脚本现在边找边落盘,所以超时被杀不等于颗粒无收 —— 先看盘上到底存下了什么,
        // 别把"已经拿到几把密钥"的情况一律报成失败(以前正是这样,扫半小时全丢)。
        const salvaged = countRecoveredKeys(platform);
        if (salvaged > 0) {
          const message = `扫描超过 30 分钟被终止,但已保住 ${salvaged} 把密钥并写入本地。`
            + '可以先试试能不能读到聊天记录;如果部分聊天打不开,再点一次「开始」会接着补齐,不用从头来。';
          onProgress?.({ phase: 'done', message, keysFound: salvaged });
          finish({ success: true, keysFound: salvaged, keysJsonPath: KEYS_JSON_FILE, keyTxtPath: KEY_FILE, log, logPath });
          return;
        }
        const message = '取密钥超时(30 分钟未完成),已终止,且没有取到任何密钥。'
          + '请确认微信正停留在主界面、且登录的就是要读取的账号;若仍不行,把 setup.log 发给我们排查。';
        onProgress?.({ phase: 'error', message });
        finish({ success: false, keysFound: 0, error: message, log, logPath });
        return;
      }
      if (aborted) {
        finish({
          success: false,
          keysFound: 0,
          error: '已取消微信密钥提取。',
          log,
          logPath,
        });
        return;
      }
      if (code !== 0) {
        const message = extractPythonError(log) || `extract_key.py 退出 code ${code}`;
        onProgress?.({
          phase: 'error',
          message,
        });
        finish({
          success: false,
          keysFound: 0,
          error: message,
          log,
          logPath,
        });
        return;
      }
      let keysFound = 0;
      try {
        if (platform === 'win32' && fs.existsSync(WINDOWS_ACCOUNTS_FILE)) {
          const accounts = JSON.parse(fs.readFileSync(WINDOWS_ACCOUNTS_FILE, 'utf8')) as Array<{ key?: string; keys?: Record<string, string>; wxid?: string }>;
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
          // 取密钥成功 = 这个账号成了"当前账号"。绑定由动作产生,不再靠 mtime 猜
          // (猜法在刚换号时必然猜错,见 active-account.ts)。
          if (keysFound > 0) bindAccountFromExtraction(accounts);
        } else if (fs.existsSync(KEYS_JSON_FILE)) {
          const map = JSON.parse(fs.readFileSync(KEYS_JSON_FILE, 'utf8')) as Record<string, string>;
          keysFound = Object.keys(map).length;
        }
      } catch { /* ignore */ }
      finish({
        success: keysFound > 0,
        keysFound,
        keysJsonPath: KEYS_JSON_FILE,
        keyTxtPath: KEY_FILE,
        log,
        logPath,
      });
    });
  });
}
