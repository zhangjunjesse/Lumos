import { NextRequest } from 'next/server';

const mockGetMessageContext = jest.fn();

jest.mock('@/lib/wechat-assistant/mirror-store', () => ({
  getMessageContext: (...args: unknown[]) => mockGetMessageContext(...args),
}));

import { GET } from '../route';

describe('wechat message context route', () => {
  beforeEach(() => {
    mockGetMessageContext.mockReset();
  });

  it('returns 400 for invalid requests', async () => {
    const res = await GET(new NextRequest('http://localhost/api/apps/builtin/wechat/search/context?wxid=&ts=0'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_context_request' });
  });

  it('returns contextual messages around the target message', async () => {
    mockGetMessageContext.mockReturnValue({
      wxid: 'alice',
      display: 'Alice',
      isGroup: false,
      targetTs: 30,
      messages: [{ ts: 20, sender: 'them', content: '上下文' }],
    });

    const res = await GET(new NextRequest('http://localhost/api/apps/builtin/wechat/search/context?wxid=alice&ts=30&radius=8'));

    expect(mockGetMessageContext).toHaveBeenCalledWith('alice', 30, 8);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      context: {
        wxid: 'alice',
        display: 'Alice',
        isGroup: false,
        targetTs: 30,
        messages: [{ ts: 20, sender: 'them', content: '上下文' }],
      },
    });
  });

  it('returns 404 when the context cannot be found', async () => {
    mockGetMessageContext.mockReturnValue(null);

    const res = await GET(new NextRequest('http://localhost/api/apps/builtin/wechat/search/context?wxid=alice&ts=30'));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'context_not_found' });
  });
});
