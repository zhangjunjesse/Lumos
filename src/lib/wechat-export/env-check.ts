/**
 * Environment probes for the wechat-export setup wizard.
 *
 * Each probe returns `{ok, detail, hint}` so the UI can display per-row
 * status, the detected version, and a one-click hint when something is
 * missing (e.g. `brew install sqlcipher`). Pure read-only operations.
 */
import fs from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import path from 'path';
import { WECHAT_APP_PATH, WECHAT_DB_ROOT } from './setup-state';

export interface ProbeResult {
  ok: boolean;
  /** Human-readable detail (version, path, …). */
  detail: string;
  /** Suggested next-step command or instruction, only when `ok=false`. */
  hint?: string;
}

const SQLCIPHER_CANDIDATES = [
  '/opt/homebrew/opt/sqlcipher/bin/sqlcipher',
  '/usr/local/opt/sqlcipher/bin/sqlcipher',
  '/opt/homebrew/bin/sqlcipher',
  '/usr/local/bin/sqlcipher',
];

const XCODE_CLT_CANDIDATES = [
  '/Library/Developer/CommandLineTools',
  '/Applications/Xcode.app/Contents/Developer',
];

function tryExec(cmd: string, args: readonly string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 3000 }).trim();
  } catch {
    return null;
  }
}

export function probeWeChat(): ProbeResult & { signed: 'tencent' | 'adhoc' | 'unknown' } {
  if (!fs.existsSync(WECHAT_APP_PATH)) {
    return {
      ok: false,
      signed: 'unknown',
      detail: '未找到 /Applications/WeChat.app',
      hint: '从 App Store 或 mac.weixin.qq.com 安装微信。',
    };
  }
  // Read CFBundleShortVersionString — `defaults read` is the supported lookup.
  const version = tryExec(
    '/usr/bin/defaults',
    ['read', `${WECHAT_APP_PATH}/Contents/Info.plist`, 'CFBundleShortVersionString'],
  ) || '';
  // `codesign -dv` writes its diagnostic details to stderr even on success.
  // execFileSync returns stdout only, so use spawnSync and parse both streams.
  const signResult = spawnSync('/usr/bin/codesign', ['-dv', WECHAT_APP_PATH], {
    encoding: 'utf8',
    timeout: 3000,
  });
  const signedAuthority = `${signResult.stdout || ''}\n${signResult.stderr || ''}`;
  const isAdhoc = /Signature=adhoc/.test(signedAuthority);
  const isTencent = /Authority=.*Tencent/.test(signedAuthority)
    || /Apple Mac OS Application Signing/.test(signedAuthority);
  const signed: 'tencent' | 'adhoc' | 'unknown' = isAdhoc
    ? 'adhoc'
    : isTencent
      ? 'tencent'
      : 'unknown';

  // 4.x WCDB layout uses the new xwechat_files path. We treat 4.x as supported.
  const major = parseInt(version.split('.')[0] || '0', 10);
  if (!version) {
    return {
      ok: false,
      signed,
      detail: '无法读取微信版本号',
      hint: '尝试重新打开微信,或重装。',
    };
  }
  if (major < 4) {
    return {
      ok: false,
      signed,
      detail: `微信版本 ${version} 不支持`,
      hint: '请升级到微信 4.x。3.x 数据库格式不同,目前未支持。',
    };
  }
  return { ok: true, signed, detail: `${version} (${signed})` };
}

export function probeSqlcipher(): ProbeResult {
  for (const cand of SQLCIPHER_CANDIDATES) {
    if (fs.existsSync(cand)) {
      const v = tryExec(cand, ['-version']) || '';
      const line = v.split('\n')[0] || '';
      return { ok: true, detail: `${cand} (${line.split(' ')[0] || 'unknown'})` };
    }
  }
  return {
    ok: false,
    detail: '未安装 sqlcipher',
    hint: 'brew install sqlcipher',
  };
}

export function probeXcodeCLT(): ProbeResult {
  for (const cand of XCODE_CLT_CANDIDATES) {
    if (fs.existsSync(cand)) {
      // lldb is what we actually need from CLT.
      const lldb = tryExec('/usr/bin/lldb', ['--version']) || '';
      return {
        ok: true,
        detail: lldb.split('\n')[0] || cand,
      };
    }
  }
  return {
    ok: false,
    detail: '未安装 Xcode 命令行工具',
    hint: 'xcode-select --install',
  };
}

export function probeWeChatDataDir(): ProbeResult & { wxid?: string } {
  if (!fs.existsSync(WECHAT_DB_ROOT)) {
    return {
      ok: false,
      detail: '未找到微信数据目录',
      hint: '请先打开微信扫码登录,让它写入本地数据。',
    };
  }
  // Match e.g. xwechat_files/<wxid>_<4-hex-suffix>/
  let foundWxid: string | undefined;
  try {
    for (const name of fs.readdirSync(WECHAT_DB_ROOT)) {
      const dbStorage = path.join(WECHAT_DB_ROOT, name, 'db_storage');
      if (fs.existsSync(dbStorage) && /_[0-9a-f]{4}$/.test(name)) {
        foundWxid = name.replace(/_[0-9a-f]{4}$/, '');
        break;
      }
    }
  } catch { /* ignore */ }
  if (!foundWxid) {
    return {
      ok: false,
      detail: '未找到登录账号的数据目录',
      hint: '请先在微信内完成登录,再回来重试。',
    };
  }
  return { ok: true, detail: `已检测到 wxid: ${foundWxid}`, wxid: foundWxid };
}

export interface EnvReport {
  wechat: ReturnType<typeof probeWeChat>;
  sqlcipher: ProbeResult;
  xcodeCLT: ProbeResult;
  dataDir: ReturnType<typeof probeWeChatDataDir>;
  /** True iff every probe returned ok. */
  allOk: boolean;
  /** Convenience: summarised codesign state for the wizard. */
  signed: 'tencent' | 'adhoc' | 'unknown';
}

export function runEnvProbes(): EnvReport {
  const wechat = probeWeChat();
  const sqlcipher = probeSqlcipher();
  const xcodeCLT = probeXcodeCLT();
  const dataDir = probeWeChatDataDir();
  return {
    wechat,
    sqlcipher,
    xcodeCLT,
    dataDir,
    allOk: wechat.ok && sqlcipher.ok && xcodeCLT.ok && dataDir.ok,
    signed: wechat.signed,
  };
}
