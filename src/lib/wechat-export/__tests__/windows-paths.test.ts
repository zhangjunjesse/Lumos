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
    });
  });

  it('accepts a parent directory that contains WeChat Files', () => {
    const root = path.join(tmp, 'Documents', 'WeChat Files');
    const wxDir = makeAccount(root);

    expect(resolveWindowsWeChatDataRootSelection(path.dirname(root))).toEqual({
      root,
      wxid: 'wxid_test',
      wxDir,
    });
  });

  it('accepts an account directory or MSG directory', () => {
    const root = path.join(tmp, 'WeChat Files');
    const wxDir = makeAccount(root);
    const msgDir = path.join(wxDir, 'MSG');

    expect(resolveWindowsWeChatDataRootSelection(wxDir)?.root).toBe(root);
    expect(resolveWindowsWeChatDataRootSelection(msgDir)?.wxDir).toBe(wxDir);
  });

  it('recognizes both Windows WeChat executable names by default', () => {
    expect(getWindowsWeChatProcessNames()).toEqual(expect.arrayContaining(['WeChat.exe', 'Weixin.exe']));
  });
});
