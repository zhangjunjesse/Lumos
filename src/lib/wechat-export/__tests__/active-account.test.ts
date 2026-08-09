// 「当前绑定的微信账号」是这次换号事故的核心修复:此前根本没有这个概念,
// 靠 windows_accounts.json 的第一条 + 消息库 mtime 猜,换号必错。

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-active-account-test-'));

jest.mock('@/lib/db', () => ({ dataDir: TMP_ROOT }));

import {
  activeAccountFile,
  backfillBoundAccount,
  bindAccountFromExtraction,
  clearBoundAccount,
  getActiveAccountKey,
  readBoundAccount,
  UNBOUND_ACCOUNT_KEY,
  writeBoundAccount,
} from '../active-account';

const KEY = 'a'.repeat(64);

beforeEach(() => {
  clearBoundAccount();
});

describe('绑定读写', () => {
  it('写入后能读回来,并带上绑定时刻', () => {
    const written = writeBoundAccount('wxid_abc123');
    expect(written?.wxid).toBe('wxid_abc123');
    expect(readBoundAccount()?.wxid).toBe('wxid_abc123');
    expect(readBoundAccount()?.boundAt).toBeGreaterThan(0);
  });

  it('没绑定时回落到 default,调用方不必各自处理 null', () => {
    expect(readBoundAccount()).toBeNull();
    expect(getActiveAccountKey()).toBe(UNBOUND_ACCOUNT_KEY);
  });

  it('清空之后回到未绑定', () => {
    writeBoundAccount('wxid_abc');
    clearBoundAccount();
    expect(readBoundAccount()).toBeNull();
  });

  it('重复绑定 = 覆盖,不会残留上一个账号', () => {
    writeBoundAccount('wxid_old');
    writeBoundAccount('wxid_new');
    expect(getActiveAccountKey()).toBe('wxid_new');
  });

  it('文件损坏时当作没绑定,不能让整个微信面板崩掉', () => {
    fs.writeFileSync(activeAccountFile(), '{ 不是 json');
    expect(readBoundAccount()).toBeNull();
    expect(getActiveAccountKey()).toBe(UNBOUND_ACCOUNT_KEY);
  });
});

describe('wxid 净化 —— 它会被当文件名用', () => {
  // 每个账号一个库文件 wechat-mirror/<wxid>.db,所以 wxid 必须挡住路径穿越,
  // 否则一个构造出来的 wxid 就能让 Lumos 往任意路径写文件、或删掉别处的库。
  it.each([
    ['../../etc/passwd', '路径穿越'],
    ['a/b', '带斜杠'],
    ['a\\b', '带反斜杠'],
    ['', '空串'],
    ['   ', '纯空格'],
    ['wxid.with.dot', '带点(可能被当扩展名)'],
    ['x'.repeat(200), '超长'],
  ])('拒绝 %s(%s)', (bad) => {
    expect(writeBoundAccount(bad)).toBeNull();
    expect(readBoundAccount()).toBeNull();
  });

  it('非字符串一律拒绝', () => {
    for (const bad of [null, undefined, 123, {}, []]) {
      expect(writeBoundAccount(bad)).toBeNull();
    }
  });

  it('正常 wxid 放行(字母数字下划线连字符)', () => {
    for (const ok of ['wxid_abc123', 'wxid-abc', 'ABC123', 'a']) {
      expect(writeBoundAccount(ok)?.wxid).toBe(ok);
    }
  });

  it('读取时也净化 —— 手改过的文件不能绕过防护', () => {
    fs.writeFileSync(activeAccountFile(), JSON.stringify({ wxid: '../../evil', boundAt: 1 }));
    expect(readBoundAccount()).toBeNull();
  });
});

describe('取密钥后确定绑定哪个账号', () => {
  it('取到密钥的那个账号成为当前账号', () => {
    bindAccountFromExtraction([{ wxid: 'wxid_new', key: KEY, extracted_at: 100 }]);
    expect(getActiveAccountKey()).toBe('wxid_new');
  });

  it('多条记录取 extracted_at 最新的 —— 历史账号会留在同一个文件里', () => {
    bindAccountFromExtraction([
      { wxid: 'wxid_old', key: KEY, extracted_at: 100 },
      { wxid: 'wxid_new', key: KEY, extracted_at: 999 },
    ]);
    expect(getActiveAccountKey()).toBe('wxid_new');
  });

  it('没密钥的记录不算数(那不是本次登录的账号)', () => {
    bindAccountFromExtraction([
      { wxid: 'wxid_nokey', extracted_at: 999 },
      { wxid: 'wxid_haskey', key: KEY, extracted_at: 1 },
    ]);
    expect(getActiveAccountKey()).toBe('wxid_haskey');
  });

  it('密钥放在 keys 映射里也认', () => {
    bindAccountFromExtraction([{ wxid: 'wxid_multi', keys: { 'msg.db': KEY }, extracted_at: 1 }]);
    expect(getActiveAccountKey()).toBe('wxid_multi');
  });

  it('全都没密钥时不绑定,不能瞎认一个', () => {
    expect(bindAccountFromExtraction([{ wxid: 'wxid_a' }, { wxid: 'wxid_b' }])).toBeNull();
    expect(readBoundAccount()).toBeNull();
  });

  it('空列表不绑定', () => {
    expect(bindAccountFromExtraction([])).toBeNull();
  });

  it('wxid 非法的记录跳过,不会写出危险文件名', () => {
    bindAccountFromExtraction([
      { wxid: '../evil', key: KEY, extracted_at: 999 },
      { wxid: 'wxid_good', key: KEY, extracted_at: 1 },
    ]);
    expect(getActiveAccountKey()).toBe('wxid_good');
  });
});

// 老用户升级补绑定:0.39.28 引入绑定,但 writeBoundAccount 只在"用户新做一次选择"
// 时触发。于是早就配好目录、也取过密钥的老用户升级后卡在"尚未绑定" —— 界面还在
// 旁边显示一个猜出来的账号,用户自然会说"我明明配过了"。(真机截图证实了这一点)
describe('从既有配置补绑定', () => {
  it('手动指定过的数据目录解析出的 wxid 直接成为绑定', () => {
    expect(backfillBoundAccount({ dataRootWxid: 'wxid_from_dir' })?.wxid).toBe('wxid_from_dir');
    expect(getActiveAccountKey()).toBe('wxid_from_dir');
  });

  it('没有数据目录时,退回唯一那个有密钥的账号', () => {
    expect(backfillBoundAccount({ keyedWxids: ['wxid_only'] })?.wxid).toBe('wxid_only');
  });

  it('数据目录优先于密钥记录 —— 前者是用户亲手选的', () => {
    const r = backfillBoundAccount({ dataRootWxid: 'wxid_dir', keyedWxids: ['wxid_key'] });
    expect(r?.wxid).toBe('wxid_dir');
  });

  it('多个账号都有密钥 → 不猜,交给用户点选', () => {
    expect(backfillBoundAccount({ keyedWxids: ['wxid_a', 'wxid_b'] })).toBeNull();
    expect(readBoundAccount()).toBeNull();
  });

  it('同一账号重复出现算一个,仍然可以补', () => {
    expect(backfillBoundAccount({ keyedWxids: ['wxid_a', 'wxid_a'] })?.wxid).toBe('wxid_a');
  });

  it('已经绑定过就不动 —— 补绑定不能覆盖用户的选择', () => {
    writeBoundAccount('wxid_chosen');
    expect(backfillBoundAccount({ dataRootWxid: 'wxid_other' })).toBeNull();
    expect(getActiveAccountKey()).toBe('wxid_chosen');
  });

  it('什么都没有就不动(真的没配过,该走正常引导)', () => {
    expect(backfillBoundAccount({})).toBeNull();
    expect(backfillBoundAccount({ dataRootWxid: null, keyedWxids: [] })).toBeNull();
  });

  it('非法 wxid 不会被补进来', () => {
    expect(backfillBoundAccount({ dataRootWxid: '../evil' })).toBeNull();
    expect(backfillBoundAccount({ keyedWxids: ['../evil'] })).toBeNull();
  });
});
