import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ContextTokenStore } from '../state';

describe('wechat/state: ContextTokenStore', () => {
  let tempDir: string;
  const originalDataDir = process.env.LUMOS_DATA_DIR;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-wechat-state-'));
    process.env.LUMOS_DATA_DIR = tempDir;
  });

  afterEach(() => {
    if (originalDataDir == null) {
      delete process.env.LUMOS_DATA_DIR;
    } else {
      process.env.LUMOS_DATA_DIR = originalDataDir;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('loads legacy default context tokens after account_id changes', () => {
    const legacyDir = path.join(tempDir, 'im-wechat', 'default');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, 'context-tokens.json'),
      JSON.stringify({ 'alice@im.wechat': 'legacy-token' }),
      'utf8',
    );

    const store = new ContextTokenStore('bot-account@im.bot');

    expect(store.get('alice@im.wechat')).toBe('legacy-token');
  });

  test('account-specific tokens override legacy default tokens', () => {
    const legacyDir = path.join(tempDir, 'im-wechat', 'default');
    const accountDir = path.join(tempDir, 'im-wechat', 'bot-account@im.bot');
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.mkdirSync(accountDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, 'context-tokens.json'),
      JSON.stringify({ 'alice@im.wechat': 'legacy-token' }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(accountDir, 'context-tokens.json'),
      JSON.stringify({ 'alice@im.wechat': 'fresh-token' }),
      'utf8',
    );

    const store = new ContextTokenStore('bot-account@im.bot');

    expect(store.get('alice@im.wechat')).toBe('fresh-token');
  });

  test('reloads token file updates written by another process', () => {
    const accountDir = path.join(tempDir, 'im-wechat', 'bot-account@im.bot');
    const tokenFile = path.join(accountDir, 'context-tokens.json');
    fs.mkdirSync(accountDir, { recursive: true });
    fs.writeFileSync(
      tokenFile,
      JSON.stringify({ 'alice@im.wechat': 'token-a' }),
      'utf8',
    );

    const store = new ContextTokenStore('bot-account@im.bot');
    expect(store.get('alice@im.wechat')).toBe('token-a');

    fs.writeFileSync(
      tokenFile,
      JSON.stringify({ 'alice@im.wechat': 'token-b-longer' }),
      'utf8',
    );

    expect(store.get('alice@im.wechat')).toBe('token-b-longer');
  });
});
