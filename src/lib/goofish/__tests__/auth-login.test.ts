import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('goofish login orchestration', () => {
  let tempDir: string;
  let runJsonCommand: jest.Mock;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-goofish-login-'));
    process.env.LUMOS_DATA_DIR = tempDir;
    jest.resetModules();

    class MockGoofishCliException extends Error {
      code: string;
      stderr?: string;
      constructor(error: { code: string; message: string; stderr?: string }) {
        super(error.message);
        this.code = error.code;
        this.stderr = error.stderr;
      }
    }

    runJsonCommand = jest.fn(async (args: string[]) => {
      if (args[0] === 'auth' && args[1] === 'status') {
        return { unb: '2231807063', tracknick: 'nick', nick: 'nick', valid: true };
      }
      throw new Error(`unexpected goofish command: ${args.join(' ')}`);
    });

    jest.doMock('../cli', () => ({
      GoofishCliException: MockGoofishCliException,
      normalizeNick: (value: string) => value,
      runJsonCommand,
    }));
    jest.doMock('../install-state', () => ({ isQrReady: () => false }));
    jest.doMock('../auth-qr', () => ({
      BuiltinBrowserQrUnavailableError: class BuiltinBrowserQrUnavailableError extends Error {},
      resolveBuiltinBrowserQrConfig: () => null,
      runBuiltinBrowserQrLogin: jest.fn(),
      runQrSidecar: jest.fn(),
    }));
  });

  afterEach(() => {
    delete process.env.LUMOS_DATA_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('paste login writes Lumos cookies directly and only validates status through goofish-cli', async () => {
    const { login } = await import('../auth');

    const status = await login({
      mode: 'paste',
      cookieString: 'Cookie: unb=2231807063; _m_h5_tk=token_123; cookie2=value=with=equals',
    });

    expect(status).toEqual(expect.objectContaining({ accountUnb: '2231807063', valid: true }));
    expect(runJsonCommand).toHaveBeenCalledTimes(1);
    expect(runJsonCommand).toHaveBeenCalledWith(
      ['auth', 'status'],
      expect.objectContaining({
        cookiesPath: path.join(tempDir, 'goofish-accounts', '2231807063', '.goofish-cli', 'cookies.json'),
      }),
    );

    const finalCookies = path.join(tempDir, 'goofish-accounts', '2231807063', '.goofish-cli', 'cookies.json');
    const parsed = JSON.parse(fs.readFileSync(finalCookies, 'utf-8')) as Array<{ name: string; value: string }>;
    expect(parsed).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'unb', value: '2231807063' }),
      expect.objectContaining({ name: '_m_h5_tk', value: 'token_123' }),
      expect.objectContaining({ name: 'cookie2', value: 'value=with=equals' }),
    ]));
  });

  test('browser login copies upstream output path into the Lumos account cookie file', async () => {
    const upstreamCookies = path.join(tempDir, 'upstream-cookies.json');
    runJsonCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === 'auth' && args[1] === 'login') {
        fs.writeFileSync(upstreamCookies, JSON.stringify([
          { name: 'unb', value: '2231807063' },
          { name: '_m_h5_tk', value: 'token_123' },
        ]));
        return { path: upstreamCookies };
      }
      if (args[0] === 'auth' && args[1] === 'status') {
        return { unb: '2231807063', tracknick: 'nick', nick: 'nick', valid: true };
      }
      throw new Error(`unexpected goofish command: ${args.join(' ')}`);
    });

    const { login } = await import('../auth');
    await login({ mode: 'browser' });

    const finalCookies = path.join(tempDir, 'goofish-accounts', '2231807063', '.goofish-cli', 'cookies.json');
    expect(JSON.parse(fs.readFileSync(finalCookies, 'utf-8'))).toEqual([
      { name: 'unb', value: '2231807063' },
      { name: '_m_h5_tk', value: 'token_123' },
    ]);
  });
});
