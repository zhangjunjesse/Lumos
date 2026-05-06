/**
 * Environment probes for the wechat-export setup wizard.
 *
 * Each probe returns `{ok, detail, hint}` so the UI can display per-row
 * status, the detected version, and a one-click hint when something is
 * missing (e.g. `brew install sqlcipher`). Pure read-only operations.
 */
import fs from 'fs';
import { execFileSync, spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import {
  WECHAT_APP_PATH,
  WECHAT_DB_ROOT,
  type WeChatExportPlatform,
  getWeChatExportPlatform,
  hasRecoveredKey,
  readWindowsAccounts,
} from './setup-state';
import { getPythonVersion, resolvePythonBinary } from '@/lib/python-runtime';

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

function parseRegValue(output: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)\s*$/);
    if (match?.[1]) return expandWindowsEnv(match[1].trim());
  }
  return null;
}

function expandWindowsEnv(input: string): string {
  return input.replace(/%([^%]+)%/g, (_, key: string) => process.env[key] || process.env[key.toUpperCase()] || '');
}

function getWindowsDocumentsCandidates(): string[] {
  const userProfile = process.env.USERPROFILE || os.homedir();
  const candidates = [
    path.join(userProfile, 'Documents'),
    process.env.OneDrive ? path.join(process.env.OneDrive, 'Documents') : '',
    process.env.OneDriveConsumer ? path.join(process.env.OneDriveConsumer, 'Documents') : '',
  ].filter(Boolean);

  try {
    const out = execFileSync('reg', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders',
      '/v',
      'Personal',
    ], { encoding: 'utf8', timeout: 3000 });
    const personal = parseRegValue(out);
    if (personal) candidates.unshift(personal);
  } catch { /* registry may be unavailable in tests or non-Windows shells */ }

  return Array.from(new Set(candidates));
}

function normalizeWindowsWeChatRoot(value: string): string | null {
  const trimmed = expandWindowsEnv(value.trim());
  if (!trimmed) return null;
  if (trimmed === 'MyDocument:') {
    const doc = getWindowsDocumentsCandidates()[0];
    return doc ? path.join(doc, 'WeChat Files') : null;
  }
  return path.basename(trimmed).toLowerCase() === 'wechat files'
    ? trimmed
    : path.join(trimmed, 'WeChat Files');
}

export function getWindowsWeChatRootCandidates(): string[] {
  const candidates: string[] = [];
  try {
    const out = execFileSync('reg', [
      'query',
      'HKCU\\Software\\Tencent\\WeChat',
      '/v',
      'FileSavePath',
    ], { encoding: 'utf8', timeout: 3000 });
    const regPath = parseRegValue(out);
    const normalized = regPath ? normalizeWindowsWeChatRoot(regPath) : null;
    if (normalized) candidates.push(normalized);
  } catch { /* keep scanning fallback locations */ }

  const appData = process.env.APPDATA;
  if (appData) {
    const iniPath = path.join(appData, 'Tencent', 'WeChat', 'All Users', 'config', '3ebffe94.ini');
    try {
      const fromIni = normalizeWindowsWeChatRoot(fs.readFileSync(iniPath, 'utf8'));
      if (fromIni) candidates.push(fromIni);
    } catch { /* ignore */ }
  }

  for (const doc of getWindowsDocumentsCandidates()) {
    candidates.push(path.join(doc, 'WeChat Files'));
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

function findWindowsAccount(root: string): { wxid: string; wxDir: string } | null {
  try {
    for (const name of fs.readdirSync(root)) {
      if (['All Users', 'Applet', 'WMPF'].includes(name)) continue;
      const wxDir = path.join(root, name);
      if (!fs.statSync(wxDir).isDirectory()) continue;
      const msgDir = path.join(wxDir, 'MSG');
      const microMsg = path.join(msgDir, 'MicroMsg.db');
      if (!fs.existsSync(microMsg)) continue;
      const hasMsgDb = fs.readdirSync(msgDir).some((file) => /^MSG\d*\.db$/i.test(file));
      if (hasMsgDb) return { wxid: name, wxDir };
    }
  } catch { /* ignore */ }
  return null;
}

function findWindowsWeChatPid(): number | null {
  try {
    const out = execFileSync('tasklist', [
      '/FI',
      'IMAGENAME eq WeChat.exe',
      '/FO',
      'CSV',
      '/NH',
    ], { encoding: 'utf8', timeout: 3000 }).trim();
    for (const line of out.split(/\r?\n/)) {
      if (!/WeChat\.exe/i.test(line)) continue;
      const fields = line.split('","').map((part) => part.replace(/^"|"$/g, ''));
      const pid = parseInt(fields[1] || '', 10);
      if (Number.isFinite(pid) && pid > 0) return pid;
    }
  } catch { /* tasklist is Windows-only */ }
  return null;
}

function findWindowsWeChatExe(): string | null {
  const candidates = [
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Tencent', 'WeChat', 'WeChat.exe') : '',
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Tencent', 'WeChat', 'WeChat.exe') : '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Tencent', 'WeChat', 'WeChat.exe') : '',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch { /* keep scanning */ }
  }
  return null;
}

export function probeWindowsWeChat(): ProbeResult & { signed: 'not_required'; pid?: number; running: boolean } {
  const pid = findWindowsWeChatPid();
  if (pid) {
    return { ok: true, signed: 'not_required', pid, running: true, detail: `Windows 微信运行中 (PID ${pid})` };
  }
  const exe = findWindowsWeChatExe();
  if (exe) {
    return {
      ok: true,
      signed: 'not_required',
      running: false,
      detail: `已安装但未运行: ${exe}`,
      hint: '读取已提取的聊天记录不需要微信保持运行；重新提取密钥时再打开微信。',
    };
  }
  return {
    ok: false,
    signed: 'not_required',
    running: false,
    detail: '未检测到 Windows 微信',
    hint: '请先安装并打开 Windows 微信，完成登录后再回来重新检查。',
  };
}

function probeWindowsPythonRuntime(): ProbeResult {
  const python = resolvePythonBinary();
  if (!python) {
    return {
      ok: false,
      detail: '未找到内置 Python 运行时',
      hint: '请重新安装新版 Lumos；Windows 安装包必须包含 python-runtime/win32/x64。',
    };
  }
  const version = getPythonVersion(python);
  return {
    ok: true,
    detail: version ? `${version} (${python})` : python,
  };
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

export function probeWindowsWeChatDataDir(): ProbeResult & { wxid?: string; root?: string; wxDir?: string } {
  for (const account of readWindowsAccounts()) {
    const wxDir = typeof account.wx_dir === 'string' ? account.wx_dir.trim() : '';
    const wxid = typeof account.wxid === 'string' ? account.wxid.trim() : '';
    if (!wxDir) continue;
    try {
      const msgDir = path.join(wxDir, 'MSG');
      const microMsg = path.join(msgDir, 'MicroMsg.db');
      const hasMsgDb = fs.existsSync(msgDir) && fs.readdirSync(msgDir).some((file) => /^MSG\d*\.db$/i.test(file));
      if (fs.existsSync(microMsg) && hasMsgDb) {
        return {
          ok: true,
          detail: `已使用已保存账号 ${wxid || path.basename(wxDir)}`,
          wxid: wxid || path.basename(wxDir),
          root: path.dirname(wxDir),
          wxDir,
        };
      }
    } catch { /* fall through to fresh discovery */ }
  }

  const candidates = getWindowsWeChatRootCandidates();
  for (const root of candidates) {
    if (!fs.existsSync(root)) continue;
    const account = findWindowsAccount(root);
    if (account) {
      return {
        ok: true,
        detail: `已检测到账号 ${account.wxid}`,
        wxid: account.wxid,
        root,
        wxDir: account.wxDir,
      };
    }
  }
  return {
    ok: false,
    detail: '未找到 Windows 微信账号数据',
    hint: '请确认微信已登录，并且“文件管理”里的保存位置仍可访问。',
  };
}

export interface EnvReport {
  platform: WeChatExportPlatform;
  wechat: ReturnType<typeof probeWeChat> | ReturnType<typeof probeWindowsWeChat>;
  sqlcipher: ProbeResult;
  xcodeCLT: ProbeResult;
  dataDir: ReturnType<typeof probeWeChatDataDir> | ReturnType<typeof probeWindowsWeChatDataDir>;
  /** True iff every probe returned ok. */
  allOk: boolean;
  /** Convenience: summarised codesign state for the wizard. */
  signed: 'tencent' | 'adhoc' | 'unknown' | 'not_required';
}

export function runEnvProbes(platform: WeChatExportPlatform = getWeChatExportPlatform() || 'darwin'): EnvReport {
  if (platform === 'win32') {
    const wechat = probeWindowsWeChat();
    const hasWindowsKey = hasRecoveredKey('win32');
    const pythonRuntime = probeWindowsPythonRuntime();
    const sqlcipher = {
      ok: true,
      detail: 'Windows 本地解密器已内置；加密库会在启用时自动安装',
    };
    const xcodeCLT = {
      ok: pythonRuntime.ok,
      detail: pythonRuntime.ok ? `Windows 进程读取组件已就绪 · ${pythonRuntime.detail}` : pythonRuntime.detail,
      hint: pythonRuntime.hint,
    };
    const dataDir = probeWindowsWeChatDataDir();
    return {
      platform,
      wechat,
      sqlcipher,
      xcodeCLT,
      dataDir,
      allOk: (wechat.ok || hasWindowsKey) && sqlcipher.ok && xcodeCLT.ok && dataDir.ok,
      signed: 'not_required',
    };
  }
  const wechat = probeWeChat();
  const sqlcipher = probeSqlcipher();
  const xcodeCLT = probeXcodeCLT();
  const dataDir = probeWeChatDataDir();
  return {
    platform,
    wechat,
    sqlcipher,
    xcodeCLT,
    dataDir,
    allOk: wechat.ok && sqlcipher.ok && xcodeCLT.ok && dataDir.ok,
    signed: wechat.signed,
  };
}
