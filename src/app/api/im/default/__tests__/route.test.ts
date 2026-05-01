// In-memory mocks for the IM config layer + provider registry. We're testing
// the GET fallback chain: explicit default → first enabled → null.

let explicitDefault: string | null = null;
let enabled: string[] = [];
let known = new Set<string>(['wechat', 'feishu']);

jest.mock('@/lib/im', () => ({
  getDefaultProviderId: () => explicitDefault,
  setDefaultProviderId: (v: string | null) => { explicitDefault = v; },
  getEnabledProviders: () => [...enabled],
  hasProvider: (id: string) => known.has(id),
}));

import { GET, PUT } from '../route';

beforeEach(() => {
  explicitDefault = null;
  enabled = [];
  known = new Set(['wechat', 'feishu']);
});

describe('GET /api/im/default', () => {
  test('null when nothing configured', async () => {
    const res = await GET();
    const data = await res.json();
    expect(data).toEqual({ provider: null, effective: null });
  });

  test('returns explicit default when set and known', async () => {
    explicitDefault = 'wechat';
    const res = await GET();
    const data = await res.json();
    expect(data).toEqual({ provider: 'wechat', effective: 'wechat' });
  });

  test('falls back to first enabled when no explicit default', async () => {
    enabled = ['feishu', 'wechat'];
    const res = await GET();
    const data = await res.json();
    expect(data).toEqual({ provider: null, effective: 'feishu' });
  });

  test('explicit default with unknown provider falls back to enabled', async () => {
    explicitDefault = 'ghost';
    enabled = ['wechat'];
    known = new Set(['wechat']);
    const res = await GET();
    const data = await res.json();
    expect(data).toEqual({ provider: 'ghost', effective: 'wechat' });
  });

  test('explicit default + enabled both empty → null effective', async () => {
    const res = await GET();
    const data = await res.json();
    expect(data.effective).toBeNull();
  });
});

describe('PUT /api/im/default', () => {
  function makeReq(body: unknown): Request {
    return new Request('http://localhost/api/im/default', {
      method: 'PUT',
      body: JSON.stringify(body),
    }) as unknown as Parameters<typeof PUT>[0];
  }

  test('sets explicit default for known provider', async () => {
    const res = await PUT(makeReq({ provider: 'wechat' }) as never);
    const data = await res.json();
    expect(data).toEqual({ provider: 'wechat' });
    expect(explicitDefault).toBe('wechat');
  });

  test('clears default when provider=null', async () => {
    explicitDefault = 'wechat';
    const res = await PUT(makeReq({ provider: null }) as never);
    expect(explicitDefault).toBeNull();
    expect((await res.json()).provider).toBeNull();
  });

  test('rejects unknown provider', async () => {
    const res = await PUT(makeReq({ provider: 'ghost' }) as never);
    expect(res.status).toBe(404);
  });
});
