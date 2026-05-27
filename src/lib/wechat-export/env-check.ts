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
  readWindowsPathConfig,
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

const WINDOWS_MESSAGE_DB_RE = /^(?:MSG|message|media|biz_message)(?:_?\d+)?\.db$/i;

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

function readRegValue(key: string, value: string): string | null {
  try {
    const out = execFileSync('reg', ['query', key, '/v', value], { encoding: 'utf8', timeout: 3000 });
    return parseRegValue(out);
  } catch {
    return null;
  }
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

export function normalizeWindowsWeChatRoot(value: string): string | null {
  const trimmed = expandWindowsEnv(value.trim());
  if (!trimmed) return null;
  if (trimmed === 'MyDocument:') {
    return getWindowsDocumentsCandidates()[0] || null;
  }
  return path.resolve(trimmed);
}

function pushWindowsRootCandidate(candidates: string[], root: string | null | undefined): void {
  if (!root) return;
  candidates.push(root);
  const base = path.basename(root).toLowerCase();
  if (base !== 'wechat files' && base !== 'xwechat_files') {
    candidates.push(path.join(root, 'WeChat Files'));
    candidates.push(path.join(root, 'xwechat_files'));
  }
}

export function getWindowsWeChatRootCandidates(): string[] {
  const candidates: string[] = [];
  const manualDataRoot = readWindowsPathConfig().wechatDataRoot;
  pushWindowsRootCandidate(candidates, manualDataRoot);

  const regPath = readRegValue('HKCU\\Software\\Tencent\\WeChat', 'FileSavePath');
  const normalizedRegPath = regPath ? normalizeWindowsWeChatRoot(regPath) : null;
  pushWindowsRootCandidate(candidates, normalizedRegPath);

  const appData = process.env.APPDATA;
  if (appData) {
    const iniPath = path.join(appData, 'Tencent', 'WeChat', 'All Users', 'config', '3ebffe94.ini');
    try {
      const fromIni = normalizeWindowsWeChatRoot(fs.readFileSync(iniPath, 'utf8'));
      pushWindowsRootCandidate(candidates, fromIni);
    } catch { /* ignore */ }
  }

  for (const doc of getWindowsDocumentsCandidates()) {
    pushWindowsRootCandidate(candidates, doc);
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

export interface WindowsAccountDiscovery {
  wxid: string;
  wxDir: string;
  msgDir: string;
  messageDbDir: string;
}

function findChildPath(parent: string, wantedName: string): string | null {
  try {
    const wanted = wantedName.toLowerCase();
    for (const name of fs.readdirSync(parent)) {
      if (name.toLowerCase() === wanted) return path.join(parent, name);
    }
    const exact = path.join(parent, wantedName);
    if (fs.existsSync(exact)) return exact;
  } catch { /* ignore */ }
  return null;
}

function hasWindowsMessageDb(dir: string): boolean {
  try {
    return fs.readdirSync(dir).some((file) => WINDOWS_MESSAGE_DB_RE.test(file));
  } catch {
    return false;
  }
}

function findLegacyWindowsMessageLayout(wxDir: string): Pick<WindowsAccountDiscovery, 'msgDir' | 'messageDbDir'> | null {
  const msgDir = findChildPath(wxDir, 'MSG') || findChildPath(wxDir, 'Msg');
  if (!msgDir) return null;
  const microMsg = path.join(msgDir, 'MicroMsg.db');
  if (!fs.existsSync(microMsg)) return null;
  if (hasWindowsMessageDb(msgDir)) {
    return { msgDir, messageDbDir: msgDir };
  }
  const multiDir = findChildPath(msgDir, 'Multi');
  if (multiDir && hasWindowsMessageDb(multiDir)) {
    return { msgDir, messageDbDir: multiDir };
  }
  return null;
}

function findDbStorageLayout(wxDir: string): Pick<WindowsAccountDiscovery, 'msgDir' | 'messageDbDir'> | null {
  const dbStorageDir = findChildPath(wxDir, 'db_storage');
  if (!dbStorageDir) return null;
  const messageDbDir = findChildPath(dbStorageDir, 'message');
  if (!messageDbDir || !hasWindowsMessageDb(messageDbDir)) return null;
  return { msgDir: dbStorageDir, messageDbDir };
}

function inspectWindowsAccountDir(wxDir: string): Pick<WindowsAccountDiscovery, 'msgDir' | 'messageDbDir'> | null {
  return findLegacyWindowsMessageLayout(wxDir) || findDbStorageLayout(wxDir);
}

export function findWindowsAccount(root: string): WindowsAccountDiscovery | null {
  const selfLayout = inspectWindowsAccountDir(root);
  if (selfLayout) {
    return { wxid: path.basename(root), wxDir: root, ...selfLayout };
  }
  try {
    for (const name of fs.readdirSync(root)) {
      if (['All Users', 'Applet', 'WMPF'].includes(name)) continue;
      const wxDir = path.join(root, name);
      if (!fs.statSync(wxDir).isDirectory()) continue;
      const legacy = inspectWindowsAccountDir(wxDir);
      if (legacy) return { wxid: name, wxDir, ...legacy };
    }
  } catch { /* ignore */ }
  return null;
}

export function resolveWindowsWeChatDataRootSelection(inputPath: string): WindowsAccountDiscovery & { root: string } | null {
  const selected = path.resolve(inputPath.trim());
  if (!selected) return null;
  try {
    const stat = fs.statSync(selected);
    if (!stat.isDirectory()) return null;
  } catch {
    return null;
  }

  const selectedAndParents: string[] = [];
  for (let current = selected, depth = 0; depth < 8; depth += 1) {
    selectedAndParents.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  for (const candidate of selectedAndParents) {
    const layout = inspectWindowsAccountDir(candidate);
    if (layout) {
      return {
        root: path.dirname(candidate),
        wxid: path.basename(candidate),
        wxDir: candidate,
        ...layout,
      };
    }
  }

  for (const candidate of selectedAndParents) {
    const directAccount = findWindowsAccount(candidate);
    if (directAccount) {
      return {
        root: candidate,
        wxid: directAccount.wxid,
        wxDir: directAccount.wxDir,
        msgDir: directAccount.msgDir,
        messageDbDir: directAccount.messageDbDir,
      };
    }

    const nestedRoots = [
      path.join(candidate, 'WeChat Files'),
      path.join(candidate, 'xwechat_files'),
    ];
    for (const nestedRoot of nestedRoots) {
      const nestedAccount = findWindowsAccount(nestedRoot);
      if (nestedAccount) {
        return {
          root: nestedRoot,
          wxid: nestedAccount.wxid,
          wxDir: nestedAccount.wxDir,
          msgDir: nestedAccount.msgDir,
          messageDbDir: nestedAccount.messageDbDir,
        };
      }
    }
  }

  return null;
}

function getManualWindowsWeChatProcessName(): string | null {
  const exe = readWindowsPathConfig().wechatExePath;
  if (!exe) return null;
  const name = path.basename(exe).trim();
  return name.toLowerCase().endsWith('.exe') ? name : null;
}

export function getWindowsWeChatProcessNames(): string[] {
  return Array.from(new Set([
    'WeChat.exe',
    'Weixin.exe',
    getManualWindowsWeChatProcessName(),
    'WeChatAppEx.exe',
    'WeixinAppEx.exe',
    'WeChatApp.exe',
    'WeixinApp.exe',
  ].filter(Boolean) as string[]));
}

interface WeChatPidProbe {
  pid: number | null;
  diagnostic: string;
}

// Detect a running WeChat in three escalating layers:
//   1. `tasklist /FI IMAGENAME eq Weixin.exe` and known helper process names
//      (cheapest, matches the historical Lumos path while covering modern
//      Windows WeChat builds).
//   2. `Get-Process` by exact .Path equality against `targetExe`. This is the
//      load-bearing layer for modern WeChat — WeChatAppEx, Weixin sub-helpers
//      and `crashpad_handler.exe` all share the same install dir but only one
//      process actually has the main exe path. Matching by path makes the
//      detector immune to future process renames.
//   3. PowerShell dump of every Process with .Path under Tencent/WeChat/Weixin.
//      Only used to populate the diagnostic field when 1+2 found nothing, so
//      the UI can surface what processes are actually live and we can tell
//      why the first two layers missed.
function findWindowsWeChatPid(targetExe: string | null = null): WeChatPidProbe {
  const names = getWindowsWeChatProcessNames();
  const lines: string[] = [];

  // Layer 1: tasklist by image name
  for (const name of names) {
    try {
      const out = execFileSync('tasklist', [
        '/FI', `IMAGENAME eq ${name}`,
        '/FO', 'CSV', '/NH',
      ], { encoding: 'utf8', timeout: 3000 }).trim();
      lines.push(`tasklist [${name}]: ${out || '(empty)'}`);
      for (const line of out.split(/\r?\n/)) {
        if (!line.toLowerCase().includes(name.toLowerCase())) continue;
        const fields = line.split('","').map((part) => part.replace(/^"|"$/g, ''));
        const pid = parseInt(fields[1] || '', 10);
        if (Number.isFinite(pid) && pid > 0) {
          return { pid, diagnostic: lines.join('\n') };
        }
      }
    } catch (err) {
      lines.push(`tasklist [${name}] error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Layer 2: PowerShell Get-Process by exact path (robust to process rename)
  if (targetExe) {
    try {
      const escaped = targetExe.replace(/'/g, "''");
      const script = `Get-Process | Where-Object { $_.Path -ieq '${escaped}' } | Select-Object -First 1 -ExpandProperty Id`;
      const out = execFileSync('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script,
      ], { encoding: 'utf8', timeout: 5000 }).trim();
      lines.push(`Get-Process path=${targetExe}: ${out || '(no match)'}`);
      const pid = parseInt(out, 10);
      if (Number.isFinite(pid) && pid > 0) {
        return { pid, diagnostic: lines.join('\n') };
      }
    } catch (err) {
      lines.push(`Get-Process path error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Layer 3: diagnostic dump — what Tencent/WeChat/Weixin processes ARE alive?
  try {
    const dumpScript = (
      "Get-Process | Where-Object { $_.Path -and ($_.Path -match 'Tencent|WeChat|Weixin') }"
      + " | Select-Object Id, ProcessName, Path"
      + " | Format-Table -AutoSize | Out-String -Width 200"
    );
    const dump = execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', dumpScript,
    ], { encoding: 'utf8', timeout: 5000 }).trim();
    lines.push(`Live Tencent/WeChat/Weixin processes:\n${dump || '(none)'}`);
  } catch (err) {
    lines.push(`process dump error: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { pid: null, diagnostic: lines.join('\n') };
}

function cleanWindowsExecutablePath(value: string | null | undefined): string | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;
  const quoted = trimmed.match(/^"([^"]+\.exe)"(?:\s*,\d+)?/i);
  if (quoted?.[1]) return path.resolve(expandWindowsEnv(quoted[1]));
  const withoutIconIndex = trimmed.replace(/,\d+$/, '');
  const exe = withoutIconIndex.match(/^[A-Z]:\\.*?\.exe$/i)
    ? withoutIconIndex
    : withoutIconIndex.match(/(.+?\.exe)(?:\s|$)/i)?.[1];
  return exe ? path.resolve(expandWindowsEnv(exe)) : null;
}

function findRunningWindowsWeChatExe(): string | null {
  const names = getWindowsWeChatProcessNames();
  for (const name of names) {
    const out = tryExec('wmic', ['process', 'where', `name='${name.replace(/'/g, "''")}'`, 'get', 'ExecutablePath', '/value']);
    const match = out?.match(/^ExecutablePath=(.+)$/im);
    const exe = cleanWindowsExecutablePath(match?.[1]);
    if (exe && fs.existsSync(exe)) return exe;
  }

  const quotedNames = names.map((name) => `'${name.replace(/'/g, "''").toLowerCase()}'`).join(',');
  const script = `$names=@(${quotedNames}); Get-Process | Where-Object { $names -contains (($_.Name + '.exe').ToLower()) -and $_.Path } | Select-Object -First 1 -ExpandProperty Path`;
  const exe = cleanWindowsExecutablePath(tryExec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]));
  if (exe && fs.existsSync(exe)) return exe;
  return null;
}

function windowsWeChatExeCandidatesFromRoot(root: string | null | undefined): string[] {
  const directExe = cleanWindowsExecutablePath(root);
  const selected = directExe || (root ? path.resolve(expandWindowsEnv(root.trim())) : '');
  if (!selected) return [];
  return [
    selected,
    path.join(selected, 'WeChat.exe'),
    path.join(selected, 'Weixin.exe'),
    path.join(selected, 'WeChat', 'WeChat.exe'),
    path.join(selected, 'Weixin', 'Weixin.exe'),
    path.join(selected, 'Tencent', 'WeChat', 'WeChat.exe'),
    path.join(selected, 'Tencent', 'Weixin', 'Weixin.exe'),
  ];
}

function findWindowsWeChatExe(): string | null {
  const manual = readWindowsPathConfig().wechatExePath;
  const candidates = [
    manual || '',
    findRunningWindowsWeChatExe() || '',
    readRegValue('HKCU\\Software\\Tencent\\WeChat', 'InstallPath') || '',
    readRegValue('HKLM\\Software\\Tencent\\WeChat', 'InstallPath') || '',
    readRegValue('HKLM\\Software\\WOW6432Node\\Tencent\\WeChat', 'InstallPath') || '',
    readRegValue('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WeChat', 'InstallLocation') || '',
    readRegValue('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WeChat', 'DisplayIcon') || '',
    readRegValue('HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WeChat', 'InstallLocation') || '',
    readRegValue('HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\WeChat', 'DisplayIcon') || '',
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Tencent') : '',
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Tencent') : '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Tencent') : '',
  ].flatMap(windowsWeChatExeCandidatesFromRoot);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch { /* keep scanning */ }
  }
  return null;
}

export function probeWindowsWeChat(): ProbeResult & { signed: 'not_required'; pid?: number; running: boolean } {
  // Resolve exe path first so the running-detection's path-equality layer can
  // use it. Both directions of inference are useful: pid → running, exe →
  // installed; we want both.
  const exe = findWindowsWeChatExe();
  const { pid, diagnostic } = findWindowsWeChatPid(exe);
  if (pid) {
    return { ok: true, signed: 'not_required', pid, running: true, detail: `Windows 微信运行中 (PID ${pid})` };
  }
  if (exe) {
    const manual = readWindowsPathConfig().wechatExePath;
    const matchedManual = manual && path.resolve(manual) === path.resolve(exe);
    // If diagnostic shows ANY Tencent/WeChat/Weixin processes alive, the user
    // almost certainly thinks WeChat is running — they're just running an exe
    // that isn't the one we found. Surface the dump in the hint so the
    // mismatch is visible without another build.
    const hasLiveProcs = /Id\s+ProcessName|live tencent/i.test(diagnostic);
    const hint = hasLiveProcs
      ? `进程检测未匹配到该 exe，但有其它微信相关进程在跑。诊断如下，把它发回开发者可以快速适配（也可以在下方手动指定微信路径）:\n${diagnostic}`
      : '读取已提取的聊天记录不需要微信保持运行；重新提取密钥时再打开微信。';
    return {
      ok: true,
      signed: 'not_required',
      running: false,
      detail: `${matchedManual ? '已指定' : '已安装但未运行'}: ${exe}`,
      hint,
    };
  }
  return {
    ok: false,
    signed: 'not_required',
    running: false,
    detail: '未检测到 Windows 微信',
    hint: `请先安装并打开 Windows 微信；如果你装在非默认位置，请在下方手动指定微信程序路径。\n进程探测诊断:\n${diagnostic}`,
  };
}

function probeWindowsPythonRuntime(): ProbeResult {
  const python = resolvePythonBinary({ minimumVersion: { major: 3, minor: 10 } });
  if (!python) {
    return {
      ok: false,
      detail: '未找到内置 Python 运行时',
      hint: '请重新安装新版 Lumos；Windows 安装包必须包含 python-runtime/win32/x64，或在 PATH 中提供 Python 3.10+。',
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

export function probeWindowsWeChatDataDir(): ProbeResult & {
  wxid?: string;
  root?: string;
  wxDir?: string;
  msgDir?: string;
  messageDbDir?: string;
} {
  for (const account of readWindowsAccounts()) {
    const wxDir = typeof account.wx_dir === 'string' ? account.wx_dir.trim() : '';
    const wxid = typeof account.wxid === 'string' ? account.wxid.trim() : '';
    if (!wxDir) continue;
    try {
      const layout = inspectWindowsAccountDir(wxDir);
      const msgDir = (typeof account.msg_dir === 'string' && account.msg_dir.trim()) || layout?.msgDir || '';
      const messageDbDir = (typeof account.message_db_dir === 'string' && account.message_db_dir.trim()) || layout?.messageDbDir || '';
      if (msgDir && messageDbDir && fs.existsSync(msgDir) && hasWindowsMessageDb(messageDbDir)) {
        return {
          ok: true,
          detail: `已使用已保存账号 ${wxid || path.basename(wxDir)}`,
          wxid: wxid || path.basename(wxDir),
          root: path.dirname(wxDir),
          wxDir,
          msgDir,
          messageDbDir,
        };
      }
    } catch { /* fall through to fresh discovery */ }
  }

  const manualDataRoot = readWindowsPathConfig().wechatDataRoot;
  if (manualDataRoot) {
    const account = resolveWindowsWeChatDataRootSelection(manualDataRoot);
    if (account) {
      return {
        ok: true,
        detail: `已使用手动选择的账号 ${account.wxid}`,
        wxid: account.wxid,
        root: account.root,
        wxDir: account.wxDir,
        msgDir: account.msgDir,
        messageDbDir: account.messageDbDir,
      };
    }
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
        msgDir: account.msgDir,
        messageDbDir: account.messageDbDir,
      };
    }
  }
  return {
    ok: false,
    detail: '未找到 Windows 微信账号数据',
    hint: '请确认微信已登录；在微信设置 > 文件管理里查看保存位置，并在下方选择该目录、WeChat Files、xwechat_files、账号目录、MSG 或 db_storage。',
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
