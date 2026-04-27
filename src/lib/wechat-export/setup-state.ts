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
export const SETUP_LOG_FILE = path.join(FEATURE_DIR, 'setup.log');

export const WECHAT_APP_PATH = '/Applications/WeChat.app';
export const WECHAT_DB_ROOT = path.join(
  os.homedir(),
  'Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files',
);

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

export function ensureFeatureDir(): string {
  if (!fs.existsSync(FEATURE_DIR)) {
    fs.mkdirSync(FEATURE_DIR, { recursive: true, mode: 0o700 });
  }
  return FEATURE_DIR;
}

export function getKeyCount(): number {
  try {
    if (!fs.existsSync(KEYS_JSON_FILE)) return 0;
    const raw = fs.readFileSync(KEYS_JSON_FILE, 'utf8');
    const map = JSON.parse(raw) as Record<string, string>;
    return Object.keys(map).length;
  } catch {
    return 0;
  }
}

export function getLastExtractedAt(): number | null {
  try {
    return fs.statSync(KEY_FILE).mtimeMs;
  } catch {
    return null;
  }
}

export function hasRecoveredKey(): boolean {
  try {
    const stat = fs.statSync(KEY_FILE);
    if (!stat.isFile() || stat.size < 32) return false;
    const content = fs.readFileSync(KEY_FILE, 'utf8').trim();
    // 32 bytes hex = 64 hex chars
    return /^[0-9a-fA-F]{64}$/.test(content);
  } catch {
    return false;
  }
}

export function readKeyFile(): string | null {
  try {
    const content = fs.readFileSync(KEY_FILE, 'utf8').trim();
    return /^[0-9a-fA-F]{64}$/.test(content) ? content : null;
  } catch {
    return null;
  }
}

/** Wipe key files + ~/.lumos/wechat-export entirely. Used by "fully uninstall". */
export function wipeFeatureData(): void {
  if (!fs.existsSync(FEATURE_DIR)) return;
  // shred the key files first so a partial rmdir failure still removes secrets.
  for (const f of [KEY_FILE, KEYS_JSON_FILE]) {
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

export function getSetupStatus(envReady: boolean, signed: 'tencent' | 'adhoc' | 'unknown'): SetupStatus {
  const hasConsent = hasValidConsent();
  const hasKey = hasRecoveredKey();
  const keyCount = getKeyCount();
  const lastExtractedAt = getLastExtractedAt();

  let phase: SetupPhase;
  if (!hasConsent) phase = 'needs-consent';
  else if (!envReady) phase = 'needs-env';
  else if (signed === 'tencent') phase = 'needs-resign';
  else if (!hasKey) phase = 'needs-extract';
  else if (signed === 'adhoc') phase = 'needs-restore';
  else phase = 'ready';

  return { phase, hasConsent, hasKey, keyCount, lastExtractedAt };
}
