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

  it('旧账号目录已不存在且检测不到活跃账号 → mismatch(stored-dir-missing)', () => {
    // 空数据根,没有任何活跃账号;存的旧账号目录也已删除
    const b = getWindowsAccountBinding({
      stored: { wxid: 'gone_xxx', wx_dir: path.join(root, 'gone_xxx') },
      roots: [root],
      boundWxid: 'gone_xxx',
    });
    expect(b.mismatch).toBe(true);
    expect(b.reason).toBe('stored-dir-missing');
    expect(b.activeWxid).toBeNull();
  });

  it('账号未变(存的=当前活跃) → 不 mismatch', () => {
    const dir = makeAccount('same_aaa', 5000);
    const b = getWindowsAccountBinding({
      stored: { wxid: 'same_aaa', wx_dir: dir },
      roots: [root],
      boundWxid: 'same_aaa',
    });
    expect(b.mismatch).toBe(false);
    expect(b.reason).toBeNull();
  });
});

// 语义修正:mtime 猜测**不能**推翻用户的显式绑定。
//
// 上一版拿"猜的账号 ≠ 存的账号"直接判 mismatch(account-switched),后果是实打实的:
// 用户刚手动配好账号,界面还在报警说检测到的是另一个号;取密钥也照着猜错的账号
// 反复验证密钥、永远验不过,一路卡到 30 分钟硬超时被杀。mtime 本身就常指错人 ——
// 新号刚登录还没写消息、旧号文件被杀毒/索引碰一下,都会翻盘。
describe('猜测不能推翻显式绑定', () => {
  it('★ 猜的是旧号、用户绑的是新号 → 不报 mismatch(此前的误报源头)', () => {
    const newDir = makeAccount('new_bbb', 1000);   // 新号刚登录,mtime 反而更旧
    makeAccount('old_aaa', 9000);                  // 旧号文件被碰过,mtime 最新 → 猜错
    const b = getWindowsAccountBinding({
      stored: { wxid: 'new_bbb', wx_dir: newDir },
      roots: [root],
      boundWxid: 'new_bbb',
    });
    expect(b.activeWxid).toBe('old_aaa');   // 猜测确实指错了
    expect(b.mismatch).toBe(false);         // 但不据此报错
    expect(b.reason).toBeNull();
    expect(b.guessDiffers).toBe(true);      // 差异如实记录,仅供参考
  });

  it('绑定账号目录还在,即使猜不出活跃账号也不报错', () => {
    const dir = makeAccount('bound_aaa', 5000);
    const b = getWindowsAccountBinding({
      stored: { wxid: 'bound_aaa', wx_dir: dir },
      roots: [path.join(root, 'empty')],   // 空根 → 猜不出
      boundWxid: 'bound_aaa',
    });
    expect(b.activeWxid).toBeNull();
    expect(b.mismatch).toBe(false);
  });

  it('storedWxid 认绑定的那个,不是记录里排第一的', () => {
    const dir = makeAccount('bound_bbb', 5000);
    const b = getWindowsAccountBinding({
      stored: { wxid: 'bound_bbb', wx_dir: dir },
      roots: [root],
      boundWxid: 'bound_bbb',
    });
    expect(b.storedWxid).toBe('bound_bbb');
  });

  it('全新用户(没绑定、没密钥记录)不报警 —— 那是正常起点', () => {
    const b = getWindowsAccountBinding({ stored: undefined, roots: [root], boundWxid: null });
    expect(b.mismatch).toBe(false);
    expect(b.reason).toBeNull();
  });
});
