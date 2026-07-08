import { NextRequest } from 'next/server';

const mockListMessagesForExport = jest.fn();

jest.mock('@/lib/wechat-assistant/mirror-store', () => ({
  listMessagesForExport: (...args: unknown[]) => mockListMessagesForExport(...args),
}));

import { GET } from '../route';

describe('wechat self-sent message export route', () => {
  beforeEach(() => {
    mockListMessagesForExport.mockReset();
  });

  it('defaults to exporting self-sent messages as csv', async () => {
    mockListMessagesForExport.mockReturnValue([{
      wxid: 'alice',
      display: 'Alice',
      isGroup: false,
      ts: 1_700_000_000,
      sender: 'me',
      senderDisplay: null,
      msgType: 1,
      content: '我发的消息',
    }]);

    const res = await GET(new NextRequest('http://localhost/api/apps/builtin/wechat/search/export'));

    expect(mockListMessagesForExport).toHaveBeenCalledWith({
      query: '',
      scope: 'all',
      sender: 'me',
      fromTs: null,
      toTs: null,
    });
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('wechat-me-messages');
    await expect(res.text()).resolves.toContain('"我发的消息"');
  });

  it('passes date range and scope filters to the export query', async () => {
    mockListMessagesForExport.mockReturnValue([]);

    await GET(new NextRequest(
      'http://localhost/api/apps/builtin/wechat/search/export?scope=group&from=2026-07-01&to=2026-07-08',
    ));

    expect(mockListMessagesForExport).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'group',
      sender: 'me',
    }));
    const options = mockListMessagesForExport.mock.calls[0]?.[0] as { fromTs: number; toTs: number };
    expect(options.fromTs).toBeGreaterThan(0);
    expect(options.toTs).toBeGreaterThan(options.fromTs);
  });
});
