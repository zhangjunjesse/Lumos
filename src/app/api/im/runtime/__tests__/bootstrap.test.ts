const fakePlugins = [
  { manifest: { id: 'feishu', label: 'Feishu', description: '', configSchema: [], capabilities: {} } },
  { manifest: { id: 'wechat-qclaw', label: 'QClaw', description: '', configSchema: [], capabilities: {} } },
  { manifest: { id: 'wechat-work', label: 'Work', description: '', configSchema: [], capabilities: {} } },
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

  test('omits feishu (legacy runtime handles it)', async () => {
    enabled.add('feishu');
    enabled.add('wechat-qclaw');
    configured.add('feishu');
    configured.add('wechat-qclaw');

    const res = await GET(makeReq());
    const data = await res.json();
    expect(data.providers).toHaveLength(1);
    expect(data.providers[0].providerId).toBe('wechat-qclaw');
  });

  test('skips disabled or unconfigured providers', async () => {
    enabled.add('wechat-qclaw'); // enabled but not configured
    configured.add('wechat-work'); // configured but not enabled

    const res = await GET(makeReq());
    const data = await res.json();
    expect(data.providers).toEqual([]);
  });

  test('returns config payload for fully ready providers', async () => {
    enabled.add('wechat-qclaw');
    configured.add('wechat-qclaw');
    enabled.add('wechat-work');
    configured.add('wechat-work');

    const res = await GET(makeReq());
    const data = await res.json();
    expect(data.providers).toHaveLength(2);
    expect(data.providers[0].config).toEqual({ _provider: 'wechat-qclaw', secret: 'X' });
  });
});
