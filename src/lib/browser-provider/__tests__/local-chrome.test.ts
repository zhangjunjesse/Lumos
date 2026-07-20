import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  detectLocalChromePath,
  getLocalChromeContext,
  isLocalChromeAvailable,
  readLocalChromeSettings,
  writeLocalChromeSettings,
  LOCAL_CHROME_CONTEXT_ID,
} from '../local-chrome';

describe('local-chrome 设置读写', () => {
  const tmpDir = path.join(os.tmpdir(), `lumos-lc-test-${process.pid}`);
  const origDataDir = process.env.LUMOS_DATA_DIR;
  const origClaudeDir = process.env.CLAUDE_GUI_DATA_DIR;

  beforeEach(() => {
    process.env.LUMOS_DATA_DIR = tmpDir;
    delete process.env.CLAUDE_GUI_DATA_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  afterAll(() => {
    if (origDataDir === undefined) delete process.env.LUMOS_DATA_DIR;
    else process.env.LUMOS_DATA_DIR = origDataDir;
    if (origClaudeDir !== undefined) process.env.CLAUDE_GUI_DATA_DIR = origClaudeDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('无配置文件时返回默认值(启用/默认 profile/可见)', () => {
    expect(readLocalChromeSettings()).toEqual({ enabled: true, profileMode: 'default', headless: false });
  });

  it('写入后能读回(round-trip)', () => {
    writeLocalChromeSettings({ enabled: false, profileMode: 'dedicated', headless: true });
    expect(readLocalChromeSettings()).toEqual({ enabled: false, profileMode: 'dedicated', headless: true });
  });

  it('非法 profileMode 归一化为 default', () => {
    writeLocalChromeSettings({ enabled: true, profileMode: 'weird' as 'default', headless: false });
    expect(readLocalChromeSettings().profileMode).toBe('default');
  });

  it('detectLocalChromePath:合法 override 直接返回该路径', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const fake = path.join(tmpDir, 'chrome-bin');
    fs.writeFileSync(fake, 'x');
    expect(detectLocalChromePath(fake)).toBe(fake);
  });

  it('禁用时:不可用、且不产出上下文(与是否装 Chrome 无关)', () => {
    const disabled = { enabled: false, profileMode: 'default' as const, headless: false };
    expect(isLocalChromeAvailable(disabled)).toBe(false);
    expect(getLocalChromeContext(disabled)).toBeNull();
  });

  it('可用时:上下文 id 与展示名正确', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const fake = path.join(tmpDir, 'chrome-bin');
    fs.writeFileSync(fake, 'x');
    const ctx = getLocalChromeContext({ enabled: true, profileMode: 'default', headless: false, chromePath: fake });
    expect(ctx).toEqual({ id: LOCAL_CHROME_CONTEXT_ID, display_name: '本地 Chrome', provider_type: 'local-chrome' });
  });
});
