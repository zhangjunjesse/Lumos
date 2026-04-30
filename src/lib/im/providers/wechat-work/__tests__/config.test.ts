import { parseWechatWorkConfig, isWechatWorkConfigValid } from '../config';

describe('wechat-work/config: parseWechatWorkConfig', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.WECHAT_WORK_CORP_ID;
    delete process.env.WECHAT_WORK_AGENT_ID;
    delete process.env.WECHAT_WORK_CORP_SECRET;
    delete process.env.WECHAT_WORK_API_BASE;
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  test('reads all fields from raw record', () => {
    const c = parseWechatWorkConfig({
      corp_id: 'ww1',
      agent_id: '1000002',
      corp_secret: 'sec',
      callback_token: 'cbtoken',
      callback_aes_key: 'aeskey',
      api_base: 'https://qyapi.example.com',
    });
    expect(c).toEqual({
      corpId: 'ww1',
      agentId: '1000002',
      corpSecret: 'sec',
      callbackToken: 'cbtoken',
      callbackAesKey: 'aeskey',
      apiBase: 'https://qyapi.example.com',
    });
  });

  test('defaults apiBase', () => {
    const c = parseWechatWorkConfig({});
    expect(c.apiBase).toBe('https://qyapi.weixin.qq.com');
  });

  test('strips trailing slash', () => {
    const c = parseWechatWorkConfig({ api_base: 'https://x/' });
    expect(c.apiBase).toBe('https://x');
  });

  test('falls back to env vars', () => {
    process.env.WECHAT_WORK_CORP_ID = 'env_corp';
    process.env.WECHAT_WORK_CORP_SECRET = 'env_sec';
    const c = parseWechatWorkConfig({});
    expect(c.corpId).toBe('env_corp');
    expect(c.corpSecret).toBe('env_sec');
  });
});

describe('wechat-work/config: isWechatWorkConfigValid', () => {
  const valid = {
    corpId: 'a',
    agentId: 'b',
    corpSecret: 'c',
    callbackToken: '',
    callbackAesKey: '',
    apiBase: 'https://qyapi.weixin.qq.com',
  };
  test('all 3 mandatory fields needed', () => {
    expect(isWechatWorkConfigValid(valid)).toBe(true);
    expect(isWechatWorkConfigValid({ ...valid, corpId: '' })).toBe(false);
    expect(isWechatWorkConfigValid({ ...valid, agentId: '' })).toBe(false);
    expect(isWechatWorkConfigValid({ ...valid, corpSecret: '' })).toBe(false);
  });
});
