import { NextRequest } from 'next/server';

const fakeGet = jest.fn();
const fakeSet = jest.fn();

jest.mock('@/lib/builtin-apps-visibility', () => ({
  getBuiltinAppVisibility: () => fakeGet(),
  setHiddenBuiltinAppIds: (ids: string[]) => fakeSet(ids),
}));

import { GET, PUT } from '../route';

describe('/api/apps/builtin/visibility', () => {
  beforeEach(() => {
    fakeGet.mockReset();
    fakeSet.mockReset();
  });

  it('GET returns the apps list', async () => {
    fakeGet.mockReturnValue([
      { id: 'wechat-assistant', name: 'WeChat', description: '', defaultVisible: true, visible: true },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.apps).toHaveLength(1);
    expect(json.apps[0].id).toBe('wechat-assistant');
  });

  it('PUT accepts {hidden: string[]} and re-reads visibility', async () => {
    fakeSet.mockReturnValue(['wechat-assistant']);
    fakeGet.mockReturnValue([
      { id: 'wechat-assistant', name: 'WeChat', description: '', defaultVisible: true, visible: false },
    ]);
    const req = new NextRequest('http://x', {
      method: 'PUT',
      body: JSON.stringify({ hidden: ['wechat-assistant'] }),
      headers: { 'content-type': 'application/json' },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hidden).toEqual(['wechat-assistant']);
    expect(json.apps[0].visible).toBe(false);
    expect(fakeSet).toHaveBeenCalledWith(['wechat-assistant']);
  });

  it('PUT with malformed body falls back to empty hidden list', async () => {
    fakeSet.mockReturnValue([]);
    fakeGet.mockReturnValue([]);
    const req = new NextRequest('http://x', {
      method: 'PUT',
      body: 'not json',
      headers: { 'content-type': 'application/json' },
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(fakeSet).toHaveBeenCalledWith([]);
  });

  it('PUT filters non-string entries from hidden array', async () => {
    fakeSet.mockReturnValue(['wechat-assistant']);
    fakeGet.mockReturnValue([]);
    const req = new NextRequest('http://x', {
      method: 'PUT',
      body: JSON.stringify({ hidden: ['wechat-assistant', 42, null, true] }),
      headers: { 'content-type': 'application/json' },
    });
    await PUT(req);
    expect(fakeSet).toHaveBeenCalledWith(['wechat-assistant']);
  });
});
