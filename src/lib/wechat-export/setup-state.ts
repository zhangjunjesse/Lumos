/**
 * WeChat export — setup state machine + filesystem layout.
 *
 * Single source of truth for "where do keys live", "is the user past
 * step N", "is wechat-export currently considered 'enabled' end-to-end".
 *
 * Persistence:
 *   - consent (disclaimer.ts) writes to settings table
 *   - per-step keys / state writes to ~/.lumos/wechat-export/
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { dataDir } from '@/lib/db';
import { hasValidConsent } from './disclaimer';

export const FEATURE_DIR = path.join(dataDir, 'wechat-export');
export const KEY_FILE = path.join(FEATURE_DIR, 'key.txt');
export const KEYS_JSON_FILE = path.join(FEATURE_DIR, 'wechat_keys.json');
export const WINDOWS_ACCOUNTS_FILE = path.join(FEATURE_DIR, 'windows_accounts.json');
export const WINDOWS_DECRYPT_DIR = path.join(FEATURE_DIR, 'windows-decrypted');
export const WINDOWS_PATH_CONFIG_FILE = path.join(FEATURE_DIR, 'windows_paths.json');
export const SETUP_LOG_FILE = path.join(FEATURE_DIR, 'setup.log');

export const WECHAT_APP_PATH = '/Applications/WeChat.app';
export const WECHAT_DB_ROOT = path.join(
  os.homedir(),
  'Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files',
);

export type WeChatExportPlatform = 'darwin' | 'win32';

export function getWeChatExportPlatform(platform = process.platform): WeChatExportPlatform | null {
  return platform === 'darwin' || platform === 'win32' ? platform : null;
}

export type SetupPhase =
  | 'needs-consent'        // user hasn't accepted disclaimer
  | 'needs-env'            // sqlcipher / xcode CLT missing or wechat 4.x not detected
  | 'needs-resign'         // env OK, but WeChat is still Tencent-signed
  | 'needs-extract'        // resigned + relaunched, but no key.txt yet
  | 'needs-restore'        // key.txt obtained, codesign still adhoc — prompt to restore
  | 'ready';               // all green; MCP can be enabled

export interface SetupStatus {
  phase: SetupPhase;
  hasConsent: boolean;
  hasKey: boolean;
  /** Number of recovered db keys. */
  keyCount: number;
  /** Last successful key extraction (epoch ms), if any. */
  lastExtractedAt: number | null;
}

export interface WindowsAccountRecord {
  wxid?: string;
  wx_dir?: string;
  msg_dir?: string;
  message_db_dir?: string;
  key?: string;
  keys?: Record<string, string>;
  extracted_at?: number;
}

export interface WindowsPathConfig {
  wechatExePath?: string;
  wechatDataRoot?: string;
  updatedAt?: number;
}

function isHexKey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value.trim());
}

export function readWindowsAccounts(): WindowsAccountRecord[] {
  try {
    if (!fs.existsSync(WINDOWS_ACCOUNTS_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(WINDOWS_ACCOUNTS_FILE, 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed as WindowsAccountRecord[] : [];
  } catch {
    return [];
  }
}

function cleanPathValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function readWindowsPathConfig(): WindowsPathConfig {
  try {
    if (!fs.existsSync(WINDOWS_PATH_CONFIG_FILE)) return {};
    const parsed = JSON.parse(fs.readFileSync(WINDOWS_PATH_CONFIG_FILE, 'utf8')) as Record<string, unknown>;
    return {
      wechatExePath: cleanPathValue(parsed.wechatExePath),
      wechatDataRoot: cleanPathValue(parsed.wechatDataRoot),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : undefined,
    };
  } catch {
    return {};
  }
}

export function writeWindowsPathConfig(patch: Partial<WindowsPathConfig>): WindowsPathConfig {
  ensureFeatureDir();
  const next: WindowsPathConfig = {
    ...readWindowsPathConfig(),
    ...patch,
    updatedAt: Date.now(),
  };
  if (!cleanPathValue(next.wechatExePath)) delete next.wechatExePath;
  if (!cleanPathValue(next.wechatDataRoot)) delete next.wechatDataRoot;
  fs.writeFileSync(WINDOWS_PATH_CONFIG_FILE, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
  return next;
}

export function clearWindowsPathConfig(kind?: 'wechatExe' | 'dataDir'): WindowsPathConfig {
  if (!kind) {
    try {
      fs.unlinkSync(WINDOWS_PATH_CONFIG_FILE);
    } catch { /* ignore */ }
    return {};
  }
  const current = readWindowsPathConfig();
  if (kind === 'wechatExe') delete current.wechatExePath;
  if (kind === 'dataDir') delete current.wechatDataRoot;
  return writeWindowsPathConfig(current);
}

function hasMacRecoveredKey(): boolean {
  try {
    const stat = fs.statSync(KEY_FILE);
    if (!stat.isFile() || stat.size < 32) return false;
    return isHexKey(fs.readFileSync(KEY_FILE, 'utf8'));
  } catch {
    return false;
  }
}

function hasWindowsRecoveredKey(): boolean {
  return readWindowsAccounts().some((account) => {
    const keys = account.keys && typeof account.keys === 'object' ? Object.values(account.keys) : [];
    if (!isHexKey(account.key) && !keys.some(isHexKey)) return false;
    return typeof account.wx_dir === 'string' && account.wx_dir.trim().length > 0;
  });
}

export function ensureFeatureDir(): string {
  if (!fs.existsSync(FEATURE_DIR)) {
    fs.mkdirSync(FEATURE_DIR, { recursive: true, mode: 0o700 });
  }
  return FEATURE_DIR;
}

export function getKeyCount(platform: WeChatExportPlatform = getWeChatExportPlatform() || 'darwin'): number {
  if (platform === 'win32') {
    return readWindowsAccounts().reduce((total, account) => {
      const keys = account.keys && typeof account.keys === 'object' ? Object.values(account.keys) : [];
      const unique = new Set([account.key, ...keys].filter(isHexKey));
      return total + unique.size;
    }, 0);
  }
  try {
    if (fs.existsSync(KEYS_JSON_FILE)) {
      const raw = fs.readFileSync(KEYS_JSON_FILE, 'utf8');
      const map = JSON.parse(raw) as Record<string, string>;
      return Object.keys(map).filter((key) => isHexKey(map[key])).length;
    }
  } catch { /* ignore */ }
  return hasMacRecoveredKey() ? 1 : 0;
}

export function getLastExtractedAt(platform: WeChatExportPlatform = getWeChatExportPlatform() || 'darwin'): number | null {
  if (platform === 'win32') {
    try {
      return fs.statSync(WINDOWS_ACCOUNTS_FILE).mtimeMs;
    } catch {
      return null;
    }
  }
  try {
    return fs.statSync(KEY_FILE).mtimeMs;
  } catch { return null; }
}

export function hasRecoveredKey(platform: WeChatExportPlatform = getWeChatExportPlatform() || 'darwin'): boolean {
  return platform === 'win32' ? hasWindowsRecoveredKey() : hasMacRecoveredKey();
}

export function readKeyFile(): string | null {
  try {
    const content = fs.readFileSync(KEY_FILE, 'utf8').trim();
    return /^[0-9a-fA-F]{64}$/.test(content) ? content : null;
  } catch {
    return null;
  }
}

/**
 * 只清微信密钥/账号绑定(windows_accounts.json + macOS key 文件),保留同意记录与
 * 手动路径配置。用于"切换微信账号/微信升级后旧密钥失效"的重新绑定(#40):清掉旧密钥
 * 让用户回到"未取密钥"状态,重新取密钥时会绑定当前活跃账号。
 */
export function clearRecoveredKeys(): void {
  for (const f of [KEY_FILE, KEYS_JSON_FILE, WINDOWS_ACCOUNTS_FILE]) {
    try {
      if (!fs.existsSync(f)) continue;
      fs.writeFileSync(f, Buffer.alloc(fs.statSync(f).size, 0)); // 先抹零再删,残留不泄密钥
      fs.unlinkSync(f);
    } catch { /* best effort */ }
  }
}

/** Wipe key files + ~/.lumos/wechat-export entirely. Used by "fully uninstall". */
export function wipeFeatureData(): void {
  if (!fs.existsSync(FEATURE_DIR)) return;
  // shred the key files first so a partial rmdir failure still removes secrets.
  for (const f of [KEY_FILE, KEYS_JSON_FILE, WINDOWS_ACCOUNTS_FILE, WINDOWS_PATH_CONFIG_FILE]) {
    try {
      if (fs.existsSync(f)) {
        const buf = Buffer.alloc(fs.statSync(f).size, 0);
        fs.writeFileSync(f, buf);
        fs.unlinkSync(f);
      }
    } catch { /* best effort */ }
  }
  try {
    fs.rmSync(FEATURE_DIR, { recursive: true, force: true });
  } catch { /* best effort */ }
}

export function getSetupStatus(
  envReady: boolean,
  signed: 'tencent' | 'adhoc' | 'unknown' | 'not_required',
  platform: WeChatExportPlatform = 'darwin',
): SetupStatus {
  const hasConsent = hasValidConsent();
  const hasKey = hasRecoveredKey(platform);
  const keyCount = getKeyCount(platform);
  const lastExtractedAt = getLastExtractedAt(platform);

  let phase: SetupPhase;
  if (!hasConsent) phase = 'needs-consent';
  else if (!envReady) phase = 'needs-env';
  else if (platform === 'win32') phase = hasKey ? 'ready' : 'needs-extract';
  else if (signed === 'tencent') phase = 'needs-resign';
  else if (!hasKey) phase = 'needs-extract';
  else if (signed === 'adhoc') phase = 'needs-restore';
  else phase = 'ready';

  return { phase, hasConsent, hasKey, keyCount, lastExtractedAt };
}
