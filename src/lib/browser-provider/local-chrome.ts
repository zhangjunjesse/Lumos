import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { LOCAL_CHROME_BROWSER_CONTEXT_ID } from './labels';

// Next.js 侧的本地 Chrome 配置与探测。Electron 端(local-chrome-launcher.ts）负责真正启动;
// 这里只做「是否装了 Chrome / 用户选项读写」,供 API 和浏览器选择器判断该不该展示该选项。

export type LocalChromeProfileMode = 'default' | 'dedicated';

export interface LocalChromeSettings {
  enabled: boolean;
  profileMode: LocalChromeProfileMode;
  headless: boolean;
  chromePath?: string;
}

// 与 labels.ts 单一来源,避免上下文 id 漂移。
export const LOCAL_CHROME_CONTEXT_ID = LOCAL_CHROME_BROWSER_CONTEXT_ID;

// 默认用 Lumos 专用 profile:默认 Chrome profile 受单例限制、Chrome 开着就接管不了(#43),
// 专用 profile 稳定、登录态持久。只有用户显式选 'default' 才用默认 profile。
const DEFAULT_SETTINGS: LocalChromeSettings = { enabled: true, profileMode: 'dedicated', headless: false };

function getDataDir(): string {
  return process.env.LUMOS_DATA_DIR || process.env.CLAUDE_GUI_DATA_DIR || path.join(os.homedir(), '.lumos');
}

function getConfigPath(): string {
  return path.join(getDataDir(), 'runtime', 'local-chrome.json');
}

function existsSafe(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** 探测本地 Google Chrome 可执行文件(与 Electron 端 launcher 保持一致的候选路径)。 */
export function detectLocalChromePath(override?: string): string | null {
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

export function readLocalChromeSettings(): LocalChromeSettings {
  try {
    const filePath = getConfigPath();
    if (!existsSafe(filePath)) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<LocalChromeSettings>;
    return {
      enabled: parsed.enabled !== false,
      profileMode: parsed.profileMode === 'default' ? 'default' : 'dedicated',
      headless: parsed.headless === true,
      chromePath: typeof parsed.chromePath === 'string' && parsed.chromePath.trim()
        ? parsed.chromePath.trim()
        : undefined,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeLocalChromeSettings(next: LocalChromeSettings): void {
  const filePath = getConfigPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload: LocalChromeSettings = {
    enabled: next.enabled !== false,
    profileMode: next.profileMode === 'default' ? 'default' : 'dedicated',
    headless: next.headless === true,
    ...(next.chromePath && next.chromePath.trim() ? { chromePath: next.chromePath.trim() } : {}),
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

/** 本地 Chrome 是否可作为浏览器选项展示:已启用 且 系统检测到 Chrome。 */
export function isLocalChromeAvailable(settings = readLocalChromeSettings()): boolean {
  return settings.enabled && Boolean(detectLocalChromePath(settings.chromePath));
}

export interface LocalChromeContextDto {
  id: string;
  display_name: string;
  provider_type: 'local-chrome';
}

export function getLocalChromeContext(settings = readLocalChromeSettings()): LocalChromeContextDto | null {
  if (!isLocalChromeAvailable(settings)) {
    return null;
  }
  return { id: LOCAL_CHROME_CONTEXT_ID, display_name: '本地 Chrome', provider_type: 'local-chrome' };
}
