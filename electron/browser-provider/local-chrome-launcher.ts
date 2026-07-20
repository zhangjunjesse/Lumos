import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// 启动本地 Google Chrome 并拿到 DevTools(CDP)HTTP 端点。
// 手法与 Puppeteer 一致:--remote-debugging-port=0 让 Chrome 选空闲端口,
// 再从 <user-data-dir>/DevToolsActivePort 读回实际端口——避免自己抢端口的竞态。

export type LocalChromeProfileMode = 'default' | 'dedicated';

export interface LocalChromeLaunchOptions {
  dataDir: string; // Lumos 数据目录(~/.lumos),用于放专用 profile
  profileMode: LocalChromeProfileMode;
  headless: boolean;
  chromePath?: string;
}

export interface LocalChromeEndpoint {
  endpoint: string; // http://127.0.0.1:<port>
  userDataDir: string;
}

/** 探测本地 Chrome 可执行文件(可被显式路径覆盖)。找不到返回 null。 */
export function detectChromePath(override?: string): string | null {
  if (override && override.trim() && existsSafe(override.trim())) {
    return override.trim();
  }
  const home = os.homedir();
  const candidates: string[] = [];
  if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    candidates.push(path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
  } else if (process.platform === 'win32') {
    const pf = process.env.PROGRAMFILES || 'C:\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    candidates.push(path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'));
    candidates.push(path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'));
    candidates.push(path.join(local, 'Google\\Chrome\\Application\\chrome.exe'));
  } else {
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/opt/google/chrome/chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    );
  }
  return candidates.find(existsSafe) ?? null;
}

/** 「默认 profile」模式用的系统 Chrome 用户数据目录。 */
export function defaultChromeUserDataDir(): string {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(local, 'Google', 'Chrome', 'User Data');
  }
  return path.join(home, '.config', 'google-chrome');
}

function existsSafe(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function resolveUserDataDir(opts: LocalChromeLaunchOptions): string {
  return opts.profileMode === 'dedicated'
    ? path.join(opts.dataDir, 'browsers', 'local-chrome')
    : defaultChromeUserDataDir();
}

function readDevToolsPort(userDataDir: string): number | null {
  try {
    const raw = fs.readFileSync(path.join(userDataDir, 'DevToolsActivePort'), 'utf-8');
    const port = Number.parseInt(raw.split('\n')[0]?.trim() || '', 10);
    return Number.isInteger(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

async function isEndpointAlive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 启动(或复用)本地 Chrome,返回 CDP HTTP 端点。
 * - 若目标 user-data-dir 已有活着的调试端口(我们上次启动、仍在运行)→ 直接复用。
 * - 默认 profile 模式下 Chrome 已被用户正常打开(无调试端口)→ 端口文件不会刷新,
 *   超时后抛出可读原因,提示先关闭 Chrome 或改用专用 profile。
 */
export async function launchLocalChrome(opts: LocalChromeLaunchOptions): Promise<LocalChromeEndpoint> {
  const chromePath = detectChromePath(opts.chromePath);
  if (!chromePath) {
    throw new Error('未检测到本地 Google Chrome，请先安装 Chrome，或在设置里指定 Chrome 路径。');
  }

  const userDataDir = resolveUserDataDir(opts);
  fs.mkdirSync(userDataDir, { recursive: true });

  // 复用:已有活着的调试端口就直接用,避免重复拉起。
  const existingPort = readDevToolsPort(userDataDir);
  if (existingPort && (await isEndpointAlive(existingPort))) {
    return { endpoint: `http://127.0.0.1:${existingPort}`, userDataDir };
  }

  // 删掉陈旧端口文件,好判断本次是否真的写了新端口。
  try {
    fs.rmSync(path.join(userDataDir, 'DevToolsActivePort'), { force: true });
  } catch {
    /* ignore */
  }

  const args = [
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--remote-allow-origins=*',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    ...(opts.headless ? ['--headless=new'] : []),
    'about:blank',
  ];
  const child = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
  child.unref();

  for (let waited = 0; waited < 20_000; waited += 300) {
    await sleep(300);
    const port = readDevToolsPort(userDataDir);
    if (port && (await isEndpointAlive(port))) {
      return { endpoint: `http://127.0.0.1:${port}`, userDataDir };
    }
  }

  throw new Error(
    opts.profileMode === 'default'
      ? '无法接管本地 Chrome 的调试端口——通常是 Chrome 已经开着你的默认配置。请先完全退出 Chrome 再试，或在设置里改用「Lumos 专用 profile」。'
      : '本地 Chrome 启动失败：调试端口未就绪。请检查 Chrome 是否可正常启动。',
  );
}
