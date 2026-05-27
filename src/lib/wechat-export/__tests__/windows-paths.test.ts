import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('@/lib/db', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest mock factory is hoisted.
  dataDir: require('path').join(require('os').tmpdir(), 'lumos-wechat-test-data'),
}));

import { getWindowsWeChatProcessNames, resolveWindowsWeChatDataRootSelection } from '../env-check';

function makeAccount(root: string, wxid = 'wxid_test'): string {
  const wxDir = path.join(root, wxid);
  const msgDir = path.join(wxDir, 'MSG');
  fs.mkdirSync(msgDir, { recursive: true });
  fs.writeFileSync(path.join(msgDir, 'MicroMsg.db'), 'micro');
  fs.writeFileSync(path.join(msgDir, 'MSG0.db'), 'msg');
  return wxDir;
}

describe('Windows WeChat manual path resolution', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-wechat-paths-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('accepts a selected WeChat Files root', () => {
    const root = path.join(tmp, 'WeChat Files');
    const wxDir = makeAccount(root);

    expect(resolveWindowsWeChatDataRootSelection(root)).toEqual({
      root,
      wxid: 'wxid_test',
      wxDir,
      msgDir: path.join(wxDir, 'MSG'),
      messageDbDir: path.join(wxDir, 'MSG'),
    });
  });

  it('accepts a parent directory that contains WeChat Files', () => {
    const root = path.join(tmp, 'Documents', 'WeChat Files');
    const wxDir = makeAccount(root);

    expect(resolveWindowsWeChatDataRootSelection(path.dirname(root))).toEqual({
      root,
      wxid: 'wxid_test',
      wxDir,
      msgDir: path.join(wxDir, 'MSG'),
      messageDbDir: path.join(wxDir, 'MSG'),
    });
  });

  it('accepts a db_storage-based account directory', () => {
    const root = path.join(tmp, 'xwechat_files');
    const wxDir = path.join(root, 'wxid_test');
    const dbStorage = path.join(wxDir, 'db_storage');
    const messageDir = path.join(dbStorage, 'message');
    fs.mkdirSync(messageDir, { recursive: true });
    fs.writeFileSync(path.join(messageDir, 'message_0.db'), 'msg');
    fs.mkdirSync(path.join(dbStorage, 'contact'), { recursive: true });
    fs.writeFileSync(path.join(dbStorage, 'contact', 'contact.db'), 'contact');

    const expected = {
      root,
      wxid: 'wxid_test',
      wxDir,
      msgDir: dbStorage,
      messageDbDir: messageDir,
    };

    expect(resolveWindowsWeChatDataRootSelection(root)).toEqual(expected);
    expect(resolveWindowsWeChatDataRootSelection(messageDir)).toEqual(expected);
  });

  it('accepts an account directory, MSG directory, or account subdirectory', () => {
    const root = path.join(tmp, 'WeChat Files');
    const wxDir = makeAccount(root);
    const msgDir = path.join(wxDir, 'MSG');
    const fileStorage = path.join(wxDir, 'FileStorage');
    fs.mkdirSync(fileStorage, { recursive: true });

    expect(resolveWindowsWeChatDataRootSelection(wxDir)).toEqual({
      root,
      wxid: 'wxid_test',
      wxDir,
      msgDir,
      messageDbDir: msgDir,
    });
    expect(resolveWindowsWeChatDataRootSelection(msgDir)).toEqual({
      root,
      wxid: 'wxid_test',
      wxDir,
      msgDir,
      messageDbDir: msgDir,
    });
    expect(resolveWindowsWeChatDataRootSelection(fileStorage)).toEqual({
      root,
      wxid: 'wxid_test',
      wxDir,
      msgDir,
      messageDbDir: msgDir,
    });
  });

  it('accepts a Msg/Multi message shard layout', () => {
    const root = path.join(tmp, 'WeChat Files');
    const wxDir = path.join(root, 'wxid_test');
    const msgDir = path.join(wxDir, 'Msg');
    const multiDir = path.join(msgDir, 'Multi');
    fs.mkdirSync(multiDir, { recursive: true });
    fs.writeFileSync(path.join(msgDir, 'MicroMsg.db'), 'micro');
    fs.writeFileSync(path.join(multiDir, 'MSG0.db'), 'msg');

    expect(resolveWindowsWeChatDataRootSelection(root)).toEqual({
      root,
      wxid: 'wxid_test',
      wxDir,
      msgDir,
      messageDbDir: multiDir,
    });
    expect(resolveWindowsWeChatDataRootSelection(multiDir)).toEqual({
      root,
      wxid: 'wxid_test',
      wxDir,
      msgDir,
      messageDbDir: multiDir,
    });
  });

  it('recognizes Windows WeChat main and helper executable names by default', () => {
    expect(getWindowsWeChatProcessNames()).toEqual(expect.arrayContaining([
      'WeChat.exe',
      'Weixin.exe',
      'WeChatAppEx.exe',
      'WeixinAppEx.exe',
      'WeChatApp.exe',
      'WeixinApp.exe',
    ]));
  });
});
