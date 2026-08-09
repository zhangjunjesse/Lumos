// 换微信号后「界面还显示上一个号的聊天数据」的根治:镜像库按账号分文件。
//
// 以前是全局单文件 wechat-mirror.db,表里的 wxid 指聊天对象而非登录账号,
// 于是两个号的联系人/消息混在一张表里 —— 清不干净也分不开。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-mirror-iso-test-'));

jest.mock('@/lib/db', () => ({ dataDir: TMP_ROOT }));

const mockActiveAccount = jest.fn<string, []>(() => 'default');
jest.mock('@/lib/wechat-export/active-account', () => ({
  getActiveAccountKey: () => mockActiveAccount(),
  UNBOUND_ACCOUNT_KEY: 'default',
}));

import {
  closeMirrorDb,
  deleteMirrorForAccount,
  getMirrorDb,
  listMirrorAccounts,
  MIRROR_DIR,
  mirrorDbPathFor,
} from '../mirror-db';

const LEGACY_PATH = path.join(TMP_ROOT, 'wechat-mirror.db');

/** sessions 表 = 会话列表(联系人/群),正是用户在界面上看到"还是上个号"的那份数据。 */
function seedContact(wxid: string) {
  getMirrorDb()
    .prepare(`INSERT OR REPLACE INTO sessions(wxid, display) VALUES(?, ?)`)
    .run(wxid, `名字-${wxid}`);
}

function listContacts(): string[] {
  return (getMirrorDb().prepare('SELECT wxid FROM sessions ORDER BY wxid').all() as { wxid: string }[])
    .map((r) => r.wxid);
}

beforeEach(() => {
  closeMirrorDb();
  mockActiveAccount.mockReturnValue('default');
  try { fs.rmSync(MIRROR_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(LEGACY_PATH, { force: true }); } catch { /* ignore */ }
});

afterAll(() => {
  closeMirrorDb();
  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('账号隔离', () => {
  it('两个账号各写各的库,互相看不见对方的数据', () => {
    mockActiveAccount.mockReturnValue('wxid_A');
    seedContact('friend_of_A');
    expect(listContacts()).toEqual(['friend_of_A']);

    mockActiveAccount.mockReturnValue('wxid_B');
    seedContact('friend_of_B');
    // 关键断言:B 的库里不该出现 A 的联系人 —— 这正是用户看到的"还是上个号的数据"
    expect(listContacts()).toEqual(['friend_of_B']);

    mockActiveAccount.mockReturnValue('wxid_A');
    expect(listContacts()).toEqual(['friend_of_A']);
  });

  it('切账号会换掉连接,不会继续往上一个账号的库里写', () => {
    mockActiveAccount.mockReturnValue('wxid_A');
    const dbA = getMirrorDb();
    mockActiveAccount.mockReturnValue('wxid_B');
    const dbB = getMirrorDb();
    expect(dbA).not.toBe(dbB);
  });

  it('账号没变时复用同一个连接(不做无谓重连)', () => {
    mockActiveAccount.mockReturnValue('wxid_A');
    expect(getMirrorDb()).toBe(getMirrorDb());
  });

  it('每个账号一个文件,文件名就是 wxid', () => {
    mockActiveAccount.mockReturnValue('wxid_A');
    seedContact('x');
    mockActiveAccount.mockReturnValue('wxid_B');
    seedContact('y');
    expect(fs.existsSync(mirrorDbPathFor('wxid_A'))).toBe(true);
    expect(fs.existsSync(mirrorDbPathFor('wxid_B'))).toBe(true);
    expect(listMirrorAccounts().sort()).toEqual(['wxid_A', 'wxid_B']);
  });
});

describe('清空某个账号', () => {
  it('删掉指定账号的库,其它账号不受影响', () => {
    mockActiveAccount.mockReturnValue('wxid_A');
    seedContact('a');
    mockActiveAccount.mockReturnValue('wxid_B');
    seedContact('b');

    deleteMirrorForAccount('wxid_A');
    expect(fs.existsSync(mirrorDbPathFor('wxid_A'))).toBe(false);
    expect(fs.existsSync(mirrorDbPathFor('wxid_B'))).toBe(true);
  });

  it('删当前正在用的库也能删掉(先断连接,否则 Windows 上会被占用)', () => {
    mockActiveAccount.mockReturnValue('wxid_A');
    seedContact('a');
    deleteMirrorForAccount('wxid_A');
    expect(fs.existsSync(mirrorDbPathFor('wxid_A'))).toBe(false);
  });

  it('删完再用会重建一个空库,数据确实没了', () => {
    mockActiveAccount.mockReturnValue('wxid_A');
    seedContact('a');
    deleteMirrorForAccount('wxid_A');
    expect(listContacts()).toEqual([]);
  });

  it('删不存在的账号不报错', () => {
    expect(() => deleteMirrorForAccount('wxid_never')).not.toThrow();
  });

  it('没有镜像目录时列表为空,不抛异常', () => {
    expect(listMirrorAccounts()).toEqual([]);
  });
});

describe('从旧的全局单文件迁移', () => {
  it('旧库归到当前绑定账号名下,历史数据不丢', () => {
    // 造一个"升级前"的全局库
    mockActiveAccount.mockReturnValue('legacy_owner');
    seedContact('old_friend');
    closeMirrorDb();
    fs.renameSync(mirrorDbPathFor('legacy_owner'), LEGACY_PATH);
    fs.rmSync(mirrorDbPathFor('legacy_owner') + '-wal', { force: true });
    fs.rmSync(mirrorDbPathFor('legacy_owner') + '-shm', { force: true });

    // 升级后首次打开:应认领旧文件
    expect(listContacts()).toEqual(['old_friend']);
    expect(fs.existsSync(LEGACY_PATH)).toBe(false);
  });

  it('目标已存在时不覆盖,把旧文件挪开即可', () => {
    mockActiveAccount.mockReturnValue('wxid_A');
    seedContact('current');
    closeMirrorDb();
    fs.writeFileSync(LEGACY_PATH, 'stale-bytes');

    expect(listContacts()).toEqual(['current']);  // 现有数据没被旧文件顶掉
    expect(fs.existsSync(LEGACY_PATH)).toBe(false);
    expect(fs.existsSync(`${LEGACY_PATH}.superseded`)).toBe(true);
  });

  it('没有旧文件时正常建新库', () => {
    mockActiveAccount.mockReturnValue('wxid_fresh');
    expect(listContacts()).toEqual([]);
    expect(fs.existsSync(mirrorDbPathFor('wxid_fresh'))).toBe(true);
  });
});
