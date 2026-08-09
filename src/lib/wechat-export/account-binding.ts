// Windows 微信账号绑定比对(#40):存储的旧账号 vs 当前活跃账号。
// 用于在"切换账号 / 微信升级导致旧密钥失效"时,提前给出明确说明与重新绑定入口。
// 纯文件系统检测(不调 Python),status 轮询可低成本调用。
//
// ⚠️ 「当前活跃账号」是**猜**出来的:按消息库文件 mtime 挑最新的那个。这个信号
// 本身不可靠 —— 新号刚登录还没写消息、旧号的文件被杀毒/索引/备份碰一下,都会
// 让它指错人。所以这里有一条铁律:
//
//   猜测不能推翻用户的显式选择。
//
// 用户手动指定过目录、或取密钥成功过,那就是**事实**;猜测只在"完全没有事实"
// 时才拿来当建议。曾经反过来做过 —— 拿猜测去判"账号不匹配"并弹警告,结果用户
// 明明刚配好账号,界面还在说"检测到当前登录的是[另一个号]",而取密钥则照着猜错
// 的账号反复验证密钥、验不过、卡到 30 分钟超时。两个症状同一个根。

import path from 'path';
import fs from 'fs';
import { detectActiveWindowsAccountFull, getWindowsWeChatRootCandidates, listWindowsAccounts } from './env-check';
import { readWindowsAccounts, readWindowsPathConfig, type WindowsAccountRecord } from './setup-state';
import { readBoundAccount } from './active-account';

export interface WindowsAccountBinding {
  /** Lumos 当前认定的账号(用户显式绑定的)。 */
  storedWxid: string | null;
  /** 该账号的数据目录是否还在。 */
  storedDirExists: boolean;
  /** 猜出来的"可能正在登录"的账号。**不可靠**,仅作建议。 */
  activeWxid: string | null;
  detectedWxids: string[];
  /** 是否确实需要重新绑定。只在有硬证据时为 true —— 猜测不算证据。 */
  mismatch: boolean;
  reason: 'stored-dir-missing' | 'no-binding' | null;
  /** 猜测与绑定不一致。仅供 UI 作提示,不构成"出错了"的结论。 */
  guessDiffers: boolean;
}

/** 扫所有候选数据根,按消息库 mtime 挑当前最活跃的账号。roots 可注入(测试用)。 */
export function detectActiveWindowsAccount(
  roots?: string[],
): { activeWxid: string | null; detectedWxids: string[] } {
  // 默认根 = 候选根 + 已存账号父目录(切账号后旧记录的兄弟目录里才有新账号)。
  const resolved = roots ?? Array.from(new Set([
    ...getWindowsWeChatRootCandidates(),
    ...readWindowsAccounts()
      .map((a) => (typeof a.wx_dir === 'string' && a.wx_dir.trim() ? path.dirname(a.wx_dir.trim()) : null))
      .filter((v): v is string => Boolean(v)),
  ]));
  const detected = new Set<string>();
  for (const root of resolved) {
    for (const acc of listWindowsAccounts(root)) detected.add(acc.wxid);
  }
  const active = detectActiveWindowsAccountFull(resolved);
  return { activeWxid: active?.wxid ?? null, detectedWxids: [...detected] };
}

function dirExists(dir: string): boolean {
  try { return Boolean(dir) && fs.existsSync(dir); } catch { return false; }
}

/** 有密钥的账号 wxid 去重列表。用来判断"没绑定"到底有没有歧义。 */
function keyedAccountWxids(accounts: WindowsAccountRecord[]): string[] {
  const found = new Set<string>();
  for (const a of accounts) {
    const wxid = a.wxid?.trim();
    if (!wxid) continue;
    if (a.key || (a.keys && Object.keys(a.keys).length > 0)) found.add(wxid);
  }
  return [...found];
}

/**
 * 判定是否需要重新绑定。仅 Windows 有意义。opts 可注入(测试用)。
 *
 * mismatch 只认硬证据:
 *   - 绑定账号的数据目录没了(换机/删号/微信换了目录)
 *   - 有密钥却从来没绑定过账号(老版本升上来的历史状态)
 * "猜出来的账号和绑定的不一样"**不算**证据 —— 那个猜测本身就常错。
 */
export function getWindowsAccountBinding(
  opts?: { stored?: WindowsAccountRecord; roots?: string[]; boundWxid?: string | null },
): WindowsAccountBinding {
  const boundWxid = opts?.boundWxid !== undefined ? opts.boundWxid : readBoundAccount()?.wxid ?? null;
  const accounts = readWindowsAccounts();
  // 绑定账号对应的那条记录;没绑定时才退回第一条(仅用于读取目录路径)。
  const stored = opts?.stored
    ?? (boundWxid ? accounts.find((a) => a.wxid?.trim() === boundWxid) : undefined)
    ?? accounts[0];

  const storedWxid = boundWxid ?? stored?.wxid?.trim() ?? null;
  const storedDir = stored?.wx_dir?.trim() || '';
  const storedDirExists = dirExists(storedDir);

  const { activeWxid, detectedWxids } = detectActiveWindowsAccount(opts?.roots);

  let mismatch = false;
  let reason: WindowsAccountBinding['reason'] = null;
  if (storedWxid && storedDir && !storedDirExists) {
    // 硬证据:认定的账号目录已经不在了,继续用它必然失败。
    mismatch = true;
    reason = 'stored-dir-missing';
  } else if (!boundWxid && keyedAccountWxids(accounts).length > 1) {
    // 没绑定 + 多个账号都有密钥 → 真有歧义,得让用户确认是哪个。
    // 只有一个账号时不吵:那就是它,无歧义 —— 老用户升级上来不该凭空多出一个警告。
    mismatch = true;
    reason = 'no-binding';
  }

  return {
    storedWxid,
    storedDirExists,
    activeWxid,
    detectedWxids,
    mismatch,
    reason,
    guessDiffers: Boolean(storedWxid && activeWxid && storedWxid !== activeWxid),
  };
}

/** 若手动配置的数据根指向旧账号目录,重新绑定时一并清掉,让重新检测挑到当前活跃账号。 */
export function shouldClearStaleDataRoot(storedWxDir: string | null): boolean {
  if (!storedWxDir) return false;
  const configured = readWindowsPathConfig().wechatDataRoot;
  if (!configured) return false;
  const norm = (s: string) => s.replace(/[\\/]+$/, '').toLowerCase();
  return norm(configured) === norm(storedWxDir);
}
