import { NextRequest } from 'next/server';

const mockGetTopicMessageContext = jest.fn();
const mockGetWeChatAssistantSettings = jest.fn();

jest.mock('@/lib/wechat-assistant/mirror-store', () => ({
  getTopicMessageContext: (...args: unknown[]) => mockGetTopicMessageContext(...args),
}));

jest.mock('@/lib/wechat-assistant/settings-store', () => ({
  getWeChatAssistantSettings: () => mockGetWeChatAssistantSettings(),
}));

import { GET } from '../route';

describe('wechat topic context route', () => {
  beforeEach(() => {
    mockGetTopicMessageContext.mockReset();
    mockGetWeChatAssistantSettings.mockReturnValue({
      excludedPersonIds: [],
      topicAnalysis: {
        whitelistPersonal: ['alice'],
        whitelistGroups: ['team@chatroom'],
      },
    });
  });

  it('returns 404 without reading message context when the source is not currently whitelisted', async () => {
    const res = await GET(new NextRequest(
      'http://localhost/api/apps/builtin/wechat/topics/context?wxid=removed%40chatroom&title=%E5%90%88%E5%90%8C',
    ));

    expect(res.status).toBe(404);
    expect(mockGetTopicMessageContext).not.toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual({ error: 'topic_context_not_found' });
  });

  it('returns 404 without reading message context when the source is excluded', async () => {
    mockGetWeChatAssistantSettings.mockReturnValue({
      excludedPersonIds: ['team@chatroom'],
      topicAnalysis: {
        whitelistPersonal: [],
        whitelistGroups: ['team@chatroom'],
      },
    });

    const res = await GET(new NextRequest(
      'http://localhost/api/apps/builtin/wechat/topics/context?wxid=team%40chatroom&title=%E5%90%88%E5%90%8C',
    ));

    expect(res.status).toBe(404);
    expect(mockGetTopicMessageContext).not.toHaveBeenCalled();
  });

  it('returns contextual messages for an allowed topic source', async () => {
    mockGetTopicMessageContext.mockReturnValue({
      wxid: 'team@chatroom',
      display: '项目群',
      isGroup: true,
      targetTs: 1_700_000_000,
      messages: [{ ts: 1_700_000_000, sender: 'them', senderDisplay: '张三', content: '合同确认' }],
    });

    const res = await GET(new NextRequest(
      'http://localhost/api/apps/builtin/wechat/topics/context?wxid=team%40chatroom&title=%E5%90%88%E5%90%8C&from=2026-05-06&to=2026-05-06',
    ));

    expect(mockGetTopicMessageContext).toHaveBeenCalledWith(expect.objectContaining({
      wxid: 'team@chatroom',
      title: '合同',
      dateFrom: '2026-05-06',
      dateTo: '2026-05-06',
      radius: 10,
    }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      context: {
        wxid: 'team@chatroom',
        display: '项目群',
      },
    });
  });
});
