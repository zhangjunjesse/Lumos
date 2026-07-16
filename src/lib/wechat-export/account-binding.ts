// Windows 微信账号绑定比对(#40):存储的旧账号 vs 当前活跃账号。
// 用于在"切换账号 / 微信升级导致旧密钥失效"时,提前给出明确说明与重新绑定入口。
// 纯文件系统检测(不调 Python),status 轮询可低成本调用。

import path from 'path';
import fs from 'fs';
import { detectActiveWindowsAccountFull, getWindowsWeChatRootCandidates, listWindowsAccounts } from './env-check';
import { readWindowsAccounts, readWindowsPathConfig, type WindowsAccountRecord } from './setup-state';

export interface WindowsAccountBinding {
  storedWxid: string | null;      // windows_accounts.json 里绑定的账号(取密钥时的账号)
  storedDirExists: boolean;       // 旧账号数据目录是否还在
  activeWxid: string | null;      // 当前最近活跃(写库)的账号
  detectedWxids: string[];        // 数据根下检测到的所有账号
  mismatch: boolean;
  reason: 'account-switched' | 'stored-dir-missing' | null;
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

/** 比对存储账号与当前活跃账号,判定是否需要重新绑定。仅 Windows 有意义。opts 可注入(测试用)。 */
export function getWindowsAccountBinding(
  opts?: { stored?: WindowsAccountRecord; roots?: string[] },
): WindowsAccountBinding {
  const stored = opts?.stored ?? readWindowsAccounts()[0];
  const storedWxid = stored?.wxid?.trim() || null;
  const storedDir = stored?.wx_dir?.trim() || '';
  const storedDirExists = Boolean(storedDir) && (() => { try { return fs.existsSync(storedDir); } catch { return false; } })();

  const { activeWxid, detectedWxids } = detectActiveWindowsAccount(opts?.roots);

  let mismatch = false;
  let reason: WindowsAccountBinding['reason'] = null;
  if (storedWxid && activeWxid && storedWxid !== activeWxid) {
    mismatch = true; reason = 'account-switched';
  } else if (storedWxid && !storedDirExists) {
    // 旧账号目录已不在(卸载/改名/换机),但存了密钥 → 也要重新绑定
    mismatch = true; reason = 'stored-dir-missing';
  }
  return { storedWxid, storedDirExists, activeWxid, detectedWxids, mismatch, reason };
}

/** 若手动配置的数据根指向旧账号目录,重新绑定时一并清掉,让重新检测挑到当前活跃账号。 */
export function shouldClearStaleDataRoot(storedWxDir: string | null): boolean {
  if (!storedWxDir) return false;
  const configured = readWindowsPathConfig().wechatDataRoot;
  if (!configured) return false;
  const norm = (s: string) => s.replace(/[\\/]+$/, '').toLowerCase();
  return norm(configured) === norm(storedWxDir);
}
