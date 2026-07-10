import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * verifyAndSaveMyScreenName 用真实 cookie 文件(temp dir) + mock 抓取库,
 * 覆盖「填的用户名 vs 登录账号」校验的每条分支。
 */
describe('identity.verifyAndSaveMyScreenName', () => {
  let tempDir: string;

  const writeCookies = (twidUserId: string) => {
    const dir = path.join(tempDir, 'x-platform');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'cookies.json'),
      JSON.stringify({ cookies: { auth_token: 'a', ct0: 'c', twid: `u=${twidUserId}` }, savedAt: 1 }),
    );
  };

  const mockScraper = (impl: () => Promise<string>) => {
    jest.doMock('../scraper', () => ({
      ensureScraper: async () => ({ getUserIdByScreenName: impl }),
    }));
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumos-x-identity-'));
    process.env.LUMOS_DATA_DIR = tempDir;
    jest.resetModules();
  });

  afterEach(() => {
    delete process.env.LUMOS_DATA_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test('empty handle → invalid', async () => {
    writeCookies('750');
    mockScraper(async () => '750');
    const { verifyAndSaveMyScreenName } = await import('../identity');
    await expect(verifyAndSaveMyScreenName('  @  ')).rejects.toMatchObject({ code: 'X_SCREEN_NAME_INVALID' });
  });

  test('not logged in → auth expired', async () => {
    mockScraper(async () => '750');
    const { verifyAndSaveMyScreenName } = await import('../identity');
    await expect(verifyAndSaveMyScreenName('Me')).rejects.toMatchObject({ code: 'X_AUTH_EXPIRED' });
  });

  test('matching id → saved, getMyScreenName returns it', async () => {
    writeCookies('750');
    mockScraper(async () => '750');
    const { verifyAndSaveMyScreenName, getMyScreenName } = await import('../identity');
    const res = await verifyAndSaveMyScreenName('@Me');
    expect(res).toEqual({ screenName: 'Me', userId: '750' });
    expect(getMyScreenName()).toBe('Me');
  });

  test('mismatched id → mismatch (this is the bug this feature caught)', async () => {
    writeCookies('750');
    mockScraper(async () => '999');
    const { verifyAndSaveMyScreenName, getMyScreenName } = await import('../identity');
    await expect(verifyAndSaveMyScreenName('a_moment_later')).rejects.toMatchObject({ code: 'X_SCREEN_NAME_MISMATCH' });
    // 不匹配时不落盘
    expect(getMyScreenName()).toBe('');
  });

  test('lookup throws → invalid (bad handle)', async () => {
    writeCookies('750');
    mockScraper(async () => { throw new Error('user not found'); });
    const { verifyAndSaveMyScreenName } = await import('../identity');
    await expect(verifyAndSaveMyScreenName('ghost')).rejects.toMatchObject({ code: 'X_SCREEN_NAME_INVALID' });
  });
});
