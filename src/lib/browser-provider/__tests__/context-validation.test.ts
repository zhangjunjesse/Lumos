// listBrowserProviderConfigs 会拉起 SQLite;本地 Chrome 分支根本不查 DB,mock 掉即可。
jest.mock('@/lib/db/browser-providers', () => ({
  listBrowserProviderConfigs: () => [],
}));

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateBrowserContextId } from '../context-validation';
import { writeLocalChromeSettings } from '../local-chrome';

describe('validateBrowserContextId — 本地 Chrome 分支(修复整条主链路被拦死的 bug)', () => {
  const tmpDir = path.join(os.tmpdir(), `lumos-cv-test-${process.pid}`);
  const fakeChrome = path.join(tmpDir, 'chrome-bin');
  const origDataDir = process.env.LUMOS_DATA_DIR;
  const origClaudeDir = process.env.CLAUDE_GUI_DATA_DIR;

  beforeEach(() => {
    process.env.LUMOS_DATA_DIR = tmpDir;
    delete process.env.CLAUDE_GUI_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(fakeChrome, 'x');
  });

  afterAll(() => {
    if (origDataDir === undefined) delete process.env.LUMOS_DATA_DIR;
    else process.env.LUMOS_DATA_DIR = origDataDir;
    if (origClaudeDir !== undefined) process.env.CLAUDE_GUI_DATA_DIR = origClaudeDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('启用 + 检测到 Chrome → 放行(而不是抛「浏览器不存在」)', () => {
    writeLocalChromeSettings({ enabled: true, profileMode: 'default', headless: false, chromePath: fakeChrome });
    expect(validateBrowserContextId('local-chrome:default')).toBe('local-chrome:default');
  });

  it('已停用 → 抛可读的「已停用」错误(不是「不存在」)', () => {
    writeLocalChromeSettings({ enabled: false, profileMode: 'default', headless: false, chromePath: fakeChrome });
    expect(() => validateBrowserContextId('local-chrome:default')).toThrow('已停用');
  });
});
