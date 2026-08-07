// 远程 MCP 的 OAuth 接入(信鸽 xgrag 这类需要登录授权的知识库)。
// 这一组只测协议层:发现、PKCE、授权地址拼装 —— 不碰数据库、不碰网络。

import { createHash } from 'crypto';
import { parseResourceMetadataUrl, probeAuthRequirement } from '../discovery';
import { createPkcePair, createState } from '../pkce';
import { buildAuthorizationUrl } from '../client';
import type { DiscoveredOAuthConfig } from '../types';

describe('parseResourceMetadataUrl', () => {
  it('从 401 的 WWW-Authenticate 里取出资源元数据地址', () => {
    const header =
      'Bearer resource_metadata="https://datadefender.cn/xgrag/.well-known/oauth-protected-resource"';
    expect(parseResourceMetadataUrl(header)).toBe(
      'https://datadefender.cn/xgrag/.well-known/oauth-protected-resource',
    );
  });

  it('带其它参数时也能取到', () => {
    const header = 'Bearer realm="x", resource_metadata="https://a.cn/.well-known/y", scope="r"';
    expect(parseResourceMetadataUrl(header)).toBe('https://a.cn/.well-known/y');
  });

  it('没有这个头、或头里没有该参数时返回 undefined(退回按约定地址猜)', () => {
    expect(parseResourceMetadataUrl(null)).toBeUndefined();
    expect(parseResourceMetadataUrl('Bearer realm="x"')).toBeUndefined();
  });
});

describe('probeAuthRequirement', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function mockFetch(impl: () => Promise<Response> | never) {
    global.fetch = jest.fn(impl) as unknown as typeof fetch;
  }

  it('401 → 需要授权,并带出资源元数据地址', async () => {
    mockFetch(async () =>
      new Response('{}', {
        status: 401,
        headers: { 'www-authenticate': 'Bearer resource_metadata="https://a.cn/.well-known/r"' },
      }),
    );
    const r = await probeAuthRequirement('https://a.cn/mcp');
    expect(r.requirement).toBe('required');
    expect(r.resourceMetadataUrl).toBe('https://a.cn/.well-known/r');
  });

  it('200 → 明确不需要授权', async () => {
    mockFetch(async () => new Response('{}', { status: 200 }));
    expect((await probeAuthRequirement('https://a.cn/mcp')).requirement).toBe('not-required');
  });

  it('网络不通 → unknown,不能谎报"不需要授权"', async () => {
    mockFetch(() => {
      throw new Error('fetch failed');
    });
    expect((await probeAuthRequirement('https://a.cn/mcp')).requirement).toBe('unknown');
  });
});

describe('PKCE', () => {
  it('challenge 必须是 verifier 的 SHA256 base64url —— 服务端就是这么验的', () => {
    const { codeVerifier, codeChallenge, codeChallengeMethod } = createPkcePair();
    const expected = createHash('sha256')
      .update(codeVerifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(codeChallenge).toBe(expected);
    expect(codeChallengeMethod).toBe('S256');
  });

  it('verifier 落在 RFC 7636 要求的 43–128 字符,且只用无需转义的字符', () => {
    const { codeVerifier } = createPkcePair();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('每次都不同 —— 复用 verifier 等于没有 PKCE', () => {
    expect(createPkcePair().codeVerifier).not.toBe(createPkcePair().codeVerifier);
    expect(createState()).not.toBe(createState());
  });
});

describe('buildAuthorizationUrl', () => {
  const discovered: DiscoveredOAuthConfig = {
    resource: 'https://datadefender.cn/xgrag/mcp',
    metadata: {
      issuer: 'https://datadefender.cn/xgrag',
      authorization_endpoint: 'https://datadefender.cn/xgrag/oauth/authorize',
      token_endpoint: 'https://datadefender.cn/xgrag/oauth/token',
    },
    scopes: ['kb.read', 'kb.write'],
  };

  function build(overrides: Partial<DiscoveredOAuthConfig> = {}) {
    return new URL(
      buildAuthorizationUrl({
        discovered: { ...discovered, ...overrides },
        registration: { client_id: 'xgc_test' },
        redirectUri: 'http://127.0.0.1:43127/api/mcp/oauth/callback',
        pkce: { codeVerifier: 'v', codeChallenge: 'chal', codeChallengeMethod: 'S256' },
        state: 'st',
      }),
    );
  }

  it('带齐授权码 + PKCE 所需参数', () => {
    const url = build();
    expect(url.origin + url.pathname).toBe('https://datadefender.cn/xgrag/oauth/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('xgc_test');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('st');
  });

  it('带 resource 参数(RFC 8707)—— 限定令牌只对这个知识库有效', () => {
    expect(build().searchParams.get('resource')).toBe('https://datadefender.cn/xgrag/mcp');
  });

  it('scope 用空格分隔;资源没声明 scope 时干脆不带该参数', () => {
    expect(build().searchParams.get('scope')).toBe('kb.read kb.write');
    expect(build({ scopes: [] }).searchParams.has('scope')).toBe(false);
  });

  it('回调地址原样传,必须与注册时一致否则服务端拒发', () => {
    expect(build().searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:43127/api/mcp/oauth/callback',
    );
  });
});
