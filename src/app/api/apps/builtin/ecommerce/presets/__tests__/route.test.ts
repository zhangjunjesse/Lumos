import { NextRequest } from 'next/server';

const fakeStore = {
  query: jest.fn(),
  create: jest.fn(),
};

jest.mock('@/lib/ecommerce-assistant/storage', () => ({
  getEcommerceStore: () => fakeStore,
  ensureBuiltinStylePresets: jest.fn(),
}));

import { GET, POST } from '../route';

describe('/api/apps/builtin/ecommerce/presets', () => {
  beforeEach(() => {
    fakeStore.query.mockReset();
    fakeStore.create.mockReset();
  });

  it('GET returns presets list', async () => {
    fakeStore.query.mockReturnValue([{ id: 'p1', name: 'catalog' }]);
    const res = await GET();
    const json = await res.json();
    expect(json.presets).toHaveLength(1);
  });

  it('POST 400 when name missing', async () => {
    const req = new NextRequest('http://localhost/api/apps/builtin/ecommerce/presets', {
      method: 'POST',
      body: JSON.stringify({ direction: 'custom' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('名称');
  });

  it('POST creates a preset and JSON-stringifies negative_rules array', async () => {
    fakeStore.create.mockReturnValue({ id: 'p2', name: 'X', direction: 'custom' });
    const req = new NextRequest('http://localhost/api/apps/builtin/ecommerce/presets', {
      method: 'POST',
      body: JSON.stringify({
        name: 'X',
        direction: 'custom',
        negative_rules: ['no clutter', 'no human'],
      }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const args = fakeStore.create.mock.calls[0][1];
    expect(typeof args.negative_rules).toBe('string');
    expect(JSON.parse(args.negative_rules)).toEqual(['no clutter', 'no human']);
    expect(args.is_builtin).toBe(false);
  });

  it('POST defaults direction to custom when missing', async () => {
    fakeStore.create.mockReturnValue({ id: 'p3', name: 'Y' });
    const req = new NextRequest('http://localhost/api/apps/builtin/ecommerce/presets', {
      method: 'POST',
      body: JSON.stringify({ name: 'Y' }),
      headers: { 'content-type': 'application/json' },
    });
    await POST(req);
    expect(fakeStore.create.mock.calls[0][1].direction).toBe('custom');
  });
});
