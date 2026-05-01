import { parseWechatConfig, isWechatConfigValid, isPeerAllowed } from '../config';

describe('wechat/config: parseWechatConfig', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.WECHAT_ILINK_TOKEN;
    delete process.env.WECHAT_ILINK_BASE_URL;
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  test('reads all fields from raw record', () => {
    const c = parseWechatConfig({
      token: 'tk',
      base_url: 'https://example.weixin/',
      account_id: 'acc1',
      allow_from: 'a@im.wechat,b@im.wechat',
    });
    expect(c).toEqual({
      token: 'tk',
      baseUrl: 'https://example.weixin',
      accountId: 'acc1',
      allowFrom: 'a@im.wechat,b@im.wechat',
    });
  });

  test('defaults sane values when raw empty', () => {
    const c = parseWechatConfig({});
    expect(c.token).toBe('');
    expect(c.baseUrl).toBe('https://ilinkai.weixin.qq.com');
    expect(c.accountId).toBe('default');
    expect(c.allowFrom).toBe('*');
  });

  test('falls back to env vars', () => {
    process.env.WECHAT_ILINK_TOKEN = 'env-tk';
    process.env.WECHAT_ILINK_BASE_URL = 'https://env.weixin';
    const c = parseWechatConfig({});
    expect(c.token).toBe('env-tk');
    expect(c.baseUrl).toBe('https://env.weixin');
  });

  test('strips trailing slash from base_url', () => {
    expect(parseWechatConfig({ base_url: 'https://x///' }).baseUrl).toBe('https://x');
  });
});

describe('wechat/config: isWechatConfigValid', () => {
  const valid = {
    token: 't',
    baseUrl: 'https://x',
    accountId: 'd',
    allowFrom: '*',
  };
  test('requires token + baseUrl', () => {
    expect(isWechatConfigValid(valid)).toBe(true);
    expect(isWechatConfigValid({ ...valid, token: '' })).toBe(false);
    expect(isWechatConfigValid({ ...valid, baseUrl: '' })).toBe(false);
  });
});

describe('wechat/config: isPeerAllowed', () => {
  const base = {
    token: 't',
    baseUrl: 'https://x',
    accountId: 'd',
    allowFrom: '*',
  };
  test('* allows everyone', () => {
    expect(isPeerAllowed(base, 'anyone@im.wechat')).toBe(true);
  });
  test('empty allowFrom = everyone', () => {
    expect(isPeerAllowed({ ...base, allowFrom: '' }, 'x')).toBe(true);
  });
  test('explicit list filters', () => {
    const c = { ...base, allowFrom: 'alice@im.wechat,bob@im.wechat' };
    expect(isPeerAllowed(c, 'alice@im.wechat')).toBe(true);
    expect(isPeerAllowed(c, 'eve@im.wechat')).toBe(false);
  });
});
