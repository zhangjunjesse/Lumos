jest.mock('@/lib/db', () => ({
  dataDir: '/tmp/lumos-test',
}));

jest.mock('@/lib/feishu-config', () => ({
  getFeishuCredentials: jest.fn(() => ({ appId: '', appSecret: '' })),
}));

jest.mock('@/lib/provider-resolver', () => ({
  resolveProviderForCapability: jest.fn(() => undefined),
}));

import { ENRICHER_MAP } from '@/lib/mcp-env-enrichers';

describe('mcp env enrichers', () => {
  test('prefers resolved browser context over stale request header context', () => {
    const enrich = ENRICHER_MAP['chrome-devtools'];

    const env = enrich({}, {
      dataDir: '/tmp/lumos-test',
      browserContextId: 'adspower:k1c1fbjj',
      browserBridgeOverride: {
        url: 'http://127.0.0.1:53273',
        token: 'token',
        browserContextId: 'embedded:default',
      },
    });

    expect(env.LUMOS_BROWSER_CONTEXT_ID).toBe('adspower:k1c1fbjj');
  });

  test('passes session id as browser lock owner for browser MCP', () => {
    const enrich = ENRICHER_MAP['chrome_devtools'];

    const env = enrich({}, {
      dataDir: '/tmp/lumos-test',
      sessionId: 'session-001',
      browserContextId: 'adspower:k1c1fbjj',
    });

    expect(env.LUMOS_BROWSER_LOCK_OWNER).toBe('session-001');
  });
});
