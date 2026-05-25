import { buildProxyEnvFromSettings, getProxyForUrl, proxyTestHooks } from '../proxy';

describe('proxy helpers', () => {
  test('uses HTTPS_PROXY for https targets', () => {
    expect(getProxyForUrl('https://lumos.miki.zj.cn/api/quota/image/consume', {
      HTTPS_PROXY: 'http://127.0.0.1:7897',
    })).toBe('http://127.0.0.1:7897');
  });

  test('falls back to HTTP_PROXY for https targets', () => {
    expect(getProxyForUrl('https://lumos.miki.zj.cn/api/quota/image/consume', {
      HTTP_PROXY: 'http://127.0.0.1:7897',
    })).toBe('http://127.0.0.1:7897');
  });

  test('honors NO_PROXY for localhost and domain suffixes', () => {
    const env = {
      HTTPS_PROXY: 'http://127.0.0.1:7897',
      NO_PROXY: 'localhost,127.0.0.1,.internal.example.com',
    };

    expect(getProxyForUrl('https://localhost:3000/api', env)).toBeNull();
    expect(getProxyForUrl('https://127.0.0.1:3000/api', env)).toBeNull();
    expect(getProxyForUrl('https://svc.internal.example.com/api', env)).toBeNull();
    expect(getProxyForUrl('https://lumos.miki.zj.cn/api', env)).toBe('http://127.0.0.1:7897');
  });

  test('matches NO_PROXY entries with explicit ports', () => {
    expect(proxyTestHooks.noProxyMatchesHost('example.com', '443', 'example.com:443')).toBe(true);
    expect(proxyTestHooks.noProxyMatchesHost('example.com', '8443', 'example.com:443')).toBe(false);
  });

  test('builds custom proxy env from Lumos settings', () => {
    const env = buildProxyEnvFromSettings({
      mode: 'custom',
      httpProxy: 'http://127.0.0.1:7897',
      httpsProxy: '',
      noProxy: 'localhost,127.0.0.1',
    }, {
      HTTPS_PROXY: 'http://old-proxy:8080',
    });

    expect(getProxyForUrl('https://api.x.com/graphql/Test', env)).toBe('http://127.0.0.1:7897');
    expect(getProxyForUrl('https://localhost:3000/api', env)).toBeNull();
  });

  test('off mode ignores proxy env vars', () => {
    const env = buildProxyEnvFromSettings({ mode: 'off' }, {
      HTTPS_PROXY: 'http://127.0.0.1:7897',
    });

    expect(getProxyForUrl('https://api.x.com/', env)).toBeNull();
  });
});
