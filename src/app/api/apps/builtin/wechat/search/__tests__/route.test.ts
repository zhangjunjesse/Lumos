import { NextRequest } from 'next/server';

const mockSearchMessages = jest.fn();

jest.mock('@/lib/wechat-assistant/mirror-store', () => ({
  searchMessages: (...args: unknown[]) => mockSearchMessages(...args),
}));

import { GET } from '../route';

describe('wechat message search route', () => {
  beforeEach(() => {
    mockSearchMessages.mockReset();
  });

  it('returns empty results for blank queries without scanning the mirror', async () => {
    const res = await GET(new NextRequest('http://localhost/api/apps/builtin/wechat/search?q='));

    expect(mockSearchMessages).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({
      query: '',
      scope: 'all',
      days: 90,
      results: [],
    });
  });

  it('passes normalized search options to the mirror store', async () => {
    mockSearchMessages.mockReturnValue([{
      wxid: 'alice',
      display: 'Alice',
      isGroup: false,
      ts: 1_700_000_000,
      sender: 'me',
      content: '合同今天确认',
    }]);

    const before = Math.floor(Date.now() / 1000) - 90 * 86400;
    const res = await GET(new NextRequest(
      'http://localhost/api/apps/builtin/wechat/search?q=%E5%90%88%E5%90%8C&scope=personal&days=90&limit=20',
    ));
    const after = Math.floor(Date.now() / 1000) - 90 * 86400;

    expect(mockSearchMessages).toHaveBeenCalledWith(expect.objectContaining({
      query: '合同',
      scope: 'personal',
      limit: 20,
    }));
    const options = mockSearchMessages.mock.calls[0]?.[0] as { sinceTs: number };
    expect(options.sinceTs).toBeGreaterThanOrEqual(before - 1);
    expect(options.sinceTs).toBeLessThanOrEqual(after + 1);
    await expect(res.json()).resolves.toMatchObject({
      query: '合同',
      scope: 'personal',
      days: 90,
      results: [{ display: 'Alice' }],
    });
  });

  it('supports all-history search and clamps the limit', async () => {
    mockSearchMessages.mockReturnValue([]);

    const res = await GET(new NextRequest(
      'http://localhost/api/apps/builtin/wechat/search?q=project&scope=group&days=all&limit=1000',
    ));

    expect(mockSearchMessages).toHaveBeenCalledWith({
      query: 'project',
      scope: 'group',
      sinceTs: null,
      limit: 100,
    });
    await expect(res.json()).resolves.toMatchObject({
      query: 'project',
      scope: 'group',
      days: 'all',
      results: [],
    });
  });
});
