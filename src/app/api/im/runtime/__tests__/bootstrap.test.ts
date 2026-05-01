const fakePlugins = [
  { manifest: { id: 'feishu', label: 'Feishu', description: '', configSchema: [], capabilities: {} } },
  { manifest: { id: 'wechat', label: 'WeChat', description: '', configSchema: [], capabilities: {} } },
];

const enabled = new Set<string>();
const configured = new Set<string>();

jest.mock('@/lib/im', () => ({
  listPlugins: () => fakePlugins,
  isProviderEnabled: (id: string) => enabled.has(id),
  isProviderConfigured: (id: string) => configured.has(id),
  getProviderConfig: (id: string) => ({ _provider: id, secret: 'X' }),
}));

let authorized = true;
jest.mock('@/lib/bridge/runtime-auth', () => ({
  isBridgeRuntimeAuthorized: () => authorized,
  bridgeRuntimeUnauthorizedResponse: () =>
    new Response('UNAUTHORIZED', { status: 401 }),
}));

import { GET } from '../bootstrap/route';

beforeEach(() => {
  enabled.clear();
  configured.clear();
  authorized = true;
});

function makeReq(): Request {
  return new Request('http://localhost/api/im/runtime/bootstrap');
}

describe('GET /api/im/runtime/bootstrap', () => {
  test('401 without auth', async () => {
    authorized = false;
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  test('Phase C: includes feishu when enabled+configured', async () => {
    enabled.add('feishu');
    enabled.add('wechat');
    configured.add('feishu');
    configured.add('wechat');

    const res = await GET(makeReq());
    const data = await res.json();
    expect(data.providers).toHaveLength(2);
    const ids = data.providers.map((p: { providerId: string }) => p.providerId).sort();
    expect(ids).toEqual(['feishu', 'wechat']);
  });

  test('skips disabled or unconfigured providers', async () => {
    enabled.add('wechat'); // enabled but not configured
    configured.add('feishu'); // configured but not enabled

    const res = await GET(makeReq());
    const data = await res.json();
    expect(data.providers).toEqual([]);
  });

  test('returns config payload for fully ready providers', async () => {
    enabled.add('feishu');
    configured.add('feishu');
    enabled.add('wechat');
    configured.add('wechat');

    const res = await GET(makeReq());
    const data = await res.json();
    expect(data.providers).toHaveLength(2);
    expect(data.providers[0].config).toEqual({ _provider: 'feishu', secret: 'X' });
  });
});
