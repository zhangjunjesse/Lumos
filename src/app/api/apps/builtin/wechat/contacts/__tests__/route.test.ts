import { NextRequest } from 'next/server';

const mockQueryWeChatApi = jest.fn();
const mockHasValidConsent = jest.fn();
const mockHasRecoveredKey = jest.fn();

jest.mock('@/lib/wechat-export/api-bridge', () => ({
  queryWeChatApi: (...args: unknown[]) => mockQueryWeChatApi(...args),
}));
jest.mock('@/lib/wechat-export/disclaimer', () => ({
  hasValidConsent: () => mockHasValidConsent(),
}));
jest.mock('@/lib/wechat-export/setup-state', () => ({
  hasRecoveredKey: () => mockHasRecoveredKey(),
}));

const originalPlatform = process.platform;
Object.defineProperty(process, 'platform', { value: 'darwin' });

import { GET } from '../route';

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
});

beforeEach(() => {
  mockQueryWeChatApi.mockReset();
  mockHasValidConsent.mockReturnValue(true);
  mockHasRecoveredKey.mockReturnValue(true);
});

describe('wechat contacts route', () => {
  it('returns product-facing names instead of internal ids', async () => {
    mockQueryWeChatApi.mockResolvedValue({
      ok: true,
      data: {
        items: [
          { wxid: '45434442516@chatroom', display: '45434442516@chatroom', is_group: true },
          { wxid: '25984985930267888@openim', display: '25984985930267888@openim', is_group: false },
          { wxid: 'team@chatroom', display: '项目群', is_group: true },
        ],
      },
    });

    const res = await GET(new NextRequest('http://localhost/api/apps/builtin/wechat/contacts'));
    const json = await res.json() as {
      ready: boolean;
      contacts: Array<{ id: string; name: string; isGroup: boolean }>;
    };

    expect(res.status).toBe(200);
    expect(json.ready).toBe(true);
    expect(json.contacts).toEqual([
      { id: '45434442516@chatroom', name: '微信群聊', isGroup: true },
      { id: '25984985930267888@openim', name: '微信联系人', isGroup: false },
      { id: 'team@chatroom', name: '项目群', isGroup: true },
    ]);
  });

  it('returns a not-ready payload when WeChat authorization is missing', async () => {
    mockHasValidConsent.mockReturnValue(false);

    const res = await GET(new NextRequest('http://localhost/api/apps/builtin/wechat/contacts'));
    const json = await res.json() as { ready: boolean; reason: string; contacts: unknown[] };

    expect(res.status).toBe(200);
    expect(json).toEqual({ ready: false, reason: 'consent_required', contacts: [] });
    expect(mockQueryWeChatApi).not.toHaveBeenCalled();
  });
});
