import { parseFeishuConfig, isFeishuConfigValid, maskFeishuSecret } from '../config';
import { DEFAULT_FEISHU_OAUTH_SCOPES } from '../manifest';

describe('feishu/config: parseFeishuConfig', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.FEISHU_APP_ID;
    delete process.env.FEISHU_APP_SECRET;
    delete process.env.FEISHU_REDIRECT_URI;
    delete process.env.FEISHU_OAUTH_SCOPES;
  });
  afterAll(() => {
    process.env = originalEnv;
  });

  test('reads all fields from raw record', () => {
    const config = parseFeishuConfig({
      app_id: 'cli_x',
      app_secret: 'sec',
      domain: 'lark',
      redirect_uri: 'https://x/cb',
      oauth_scopes: 'a b c',
    });
    expect(config).toEqual({
      appId: 'cli_x',
      appSecret: 'sec',
      domain: 'lark',
      redirectUri: 'https://x/cb',
      oauthScopes: 'a b c',
    });
  });

  test('falls back to env vars when raw is empty', () => {
    process.env.FEISHU_APP_ID = 'env_id';
    process.env.FEISHU_APP_SECRET = 'env_sec';
    const config = parseFeishuConfig({});
    expect(config.appId).toBe('env_id');
    expect(config.appSecret).toBe('env_sec');
  });

  test('defaults oauthScopes to DEFAULT_FEISHU_OAUTH_SCOPES', () => {
    expect(parseFeishuConfig({}).oauthScopes).toBe(DEFAULT_FEISHU_OAUTH_SCOPES);
  });

  test('normalizes domain — invalid value falls back to feishu', () => {
    expect(parseFeishuConfig({ domain: 'feishu' }).domain).toBe('feishu');
    expect(parseFeishuConfig({ domain: 'lark' }).domain).toBe('lark');
    expect(parseFeishuConfig({ domain: 'bogus' }).domain).toBe('feishu');
    expect(parseFeishuConfig({}).domain).toBe('feishu');
  });
});

describe('feishu/config: isFeishuConfigValid', () => {
  const base = {
    domain: 'feishu' as const,
    redirectUri: '',
    oauthScopes: '',
  };
  test('requires both appId and appSecret', () => {
    expect(isFeishuConfigValid({ ...base, appId: '', appSecret: '' })).toBe(false);
    expect(isFeishuConfigValid({ ...base, appId: 'x', appSecret: '' })).toBe(false);
    expect(isFeishuConfigValid({ ...base, appId: '', appSecret: 'y' })).toBe(false);
    expect(isFeishuConfigValid({ ...base, appId: 'x', appSecret: 'y' })).toBe(true);
  });
});

describe('feishu/config: maskFeishuSecret', () => {
  test('mask short secret with stars', () => {
    expect(maskFeishuSecret('abc')).toBe('***');
  });
  test('mask long secret with prefix and last 8 chars', () => {
    expect(maskFeishuSecret('abcdefghijkl')).toBe('***efghijkl');
  });
  test('empty input returns empty', () => {
    expect(maskFeishuSecret('')).toBe('');
  });
});
