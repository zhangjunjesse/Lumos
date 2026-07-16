// #40 账号绑定检测回归:切换账号/旧目录消失的识别 + 按 mtime 挑当前活跃账号。
// 纯文件系统逻辑(Windows 真机的 extract-key/session.db 解密另需真机验证)。

import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectActiveWindowsAccount, getWindowsAccountBinding } from '../account-binding';
import { detectActiveWindowsAccountFull, listWindowsAccounts } from '../env-check';

let root: string;

// 造一个账号目录:db_storage/message/ 下放一个消息库文件,mtime 可控。
function makeAccount(wxid: string, mtimeMs: number): string {
  const wxDir = path.join(root, wxid);
  const msgDir = path.join(wxDir, 'db_storage', 'message');
  fs.mkdirSync(msgDir, { recursive: true });
  const db = path.join(msgDir, 'message_0.db');
  fs.writeFileSync(db, 'x');
  fs.utimesSync(db, new Date(mtimeMs), new Date(mtimeMs));
  return wxDir;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-acc-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('account-binding (#40)', () => {
  it('listWindowsAccounts 列出所有账号并带活跃时间', () => {
    makeAccount('old_aaa', 1000);
    makeAccount('new_bbb', 9000);
    const accounts = listWindowsAccounts(root).sort((a, b) => a.wxid.localeCompare(b.wxid));
    expect(accounts.map((a) => a.wxid)).toEqual(['new_bbb', 'old_aaa']);
    expect(accounts.find((a) => a.wxid === 'new_bbb')!.lastActiveMs).toBe(9000);
  });

  it('detectActiveWindowsAccountFull 挑活跃账号的完整信息(取密钥对准它)', () => {
    makeAccount('old_aaa', 1000);
    const newDir = makeAccount('new_bbb', 9000);
    const active = detectActiveWindowsAccountFull([root]);
    expect(active?.wxid).toBe('new_bbb');
    expect(active?.wxDir).toBe(newDir);
    expect(active?.messageDbDir).toContain('new_bbb'); // 指向新账号的库目录,不是旧的
  });

  it('detectActiveWindowsAccount 按最新 mtime 挑当前活跃账号', () => {
    makeAccount('old_aaa', 1000);
    makeAccount('new_bbb', 9000);
    const { activeWxid, detectedWxids } = detectActiveWindowsAccount([root]);
    expect(activeWxid).toBe('new_bbb');
    expect(detectedWxids.sort()).toEqual(['new_bbb', 'old_aaa']);
  });

  it('切换账号:存的是旧账号、当前活跃是新账号 → mismatch(account-switched)', () => {
    const oldDir = makeAccount('old_aaa', 1000);
    makeAccount('new_bbb', 9000);
    const b = getWindowsAccountBinding({ stored: { wxid: 'old_aaa', wx_dir: oldDir }, roots: [root] });
    expect(b.mismatch).toBe(true);
    expect(b.reason).toBe('account-switched');
    expect(b.storedWxid).toBe('old_aaa');
    expect(b.activeWxid).toBe('new_bbb');
  });

  it('旧账号目录已不存在且检测不到活跃账号 → mismatch(stored-dir-missing)', () => {
    // 空数据根,没有任何活跃账号;存的旧账号目录也已删除
    const b = getWindowsAccountBinding({ stored: { wxid: 'gone_xxx', wx_dir: path.join(root, 'gone_xxx') }, roots: [root] });
    expect(b.mismatch).toBe(true);
    expect(b.reason).toBe('stored-dir-missing');
    expect(b.activeWxid).toBeNull();
  });

  it('切到新账号且旧目录也没了 → 归为 account-switched(更准的说法)', () => {
    makeAccount('new_bbb', 9000);
    const b = getWindowsAccountBinding({ stored: { wxid: 'gone_xxx', wx_dir: path.join(root, 'gone_xxx') }, roots: [root] });
    expect(b.mismatch).toBe(true);
    expect(b.reason).toBe('account-switched');
    expect(b.activeWxid).toBe('new_bbb');
  });

  it('账号未变(存的=当前活跃) → 不 mismatch', () => {
    const dir = makeAccount('same_aaa', 5000);
    const b = getWindowsAccountBinding({ stored: { wxid: 'same_aaa', wx_dir: dir }, roots: [root] });
    expect(b.mismatch).toBe(false);
    expect(b.reason).toBeNull();
  });
});
