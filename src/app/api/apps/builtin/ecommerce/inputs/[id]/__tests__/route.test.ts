import { NextRequest } from 'next/server';

const fakeStore = {
  update: jest.fn(),
  delete: jest.fn(),
};
const fakeGetInput = jest.fn();

jest.mock('@/lib/ecommerce-assistant/storage', () => ({
  getEcommerceStore: () => fakeStore,
  getInput: (...args: unknown[]) => fakeGetInput(...args),
}));

import { DELETE, GET, PATCH } from '../route';

describe('/api/apps/builtin/ecommerce/inputs/[id]', () => {
  beforeEach(() => {
    fakeStore.update.mockReset();
    fakeStore.delete.mockReset();
    fakeGetInput.mockReset();
  });

  it('GET 200 returns input row', async () => {
    fakeGetInput.mockReturnValue({ id: 'i1', title: 'A' });
    const res = await GET(new NextRequest('http://x'), { params: Promise.resolve({ id: 'i1' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.input.title).toBe('A');
  });

  it('GET 404 when input missing', async () => {
    fakeGetInput.mockReturnValue(null);
    const res = await GET(new NextRequest('http://x'), { params: Promise.resolve({ id: 'i1' }) });
    expect(res.status).toBe(404);
  });

  it('PATCH 200 updates fields', async () => {
    fakeStore.update.mockReturnValue({ id: 'i1', title: 'B' });
    const req = new NextRequest('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'B', status: 'archived' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'i1' }) });
    expect(res.status).toBe(200);
    const callArgs = fakeStore.update.mock.calls[0];
    expect(callArgs[2]).toEqual(expect.objectContaining({ title: 'B', status: 'archived' }));
  });

  it('PATCH 404 when input missing', async () => {
    fakeStore.update.mockReturnValue(null);
    const req = new NextRequest('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ title: 'B' }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'missing' }) });
    expect(res.status).toBe(404);
  });

  it('DELETE 200 on success', async () => {
    fakeStore.delete.mockReturnValue(true);
    const res = await DELETE(new NextRequest('http://x', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'i1' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it('DELETE 404 when input missing', async () => {
    fakeStore.delete.mockReturnValue(false);
    const res = await DELETE(new NextRequest('http://x', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
  });
});
