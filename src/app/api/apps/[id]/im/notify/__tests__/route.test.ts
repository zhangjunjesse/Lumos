import { NextRequest } from 'next/server';

import { POST } from '../route';

const mockSendAppImNotification = jest.fn();
const mockGetAppPlatformService = jest.fn();

jest.mock('@/lib/app/im-notifications', () => ({
  sendAppImNotification: (...args: unknown[]) => mockSendAppImNotification(...args),
}));

jest.mock('@/lib/app/service', () => ({
  getAppPlatformService: () => mockGetAppPlatformService(),
}));

describe('POST /api/apps/[id]/im/notify', () => {
  beforeEach(() => {
    mockSendAppImNotification.mockReset();
    mockGetAppPlatformService.mockReset();
  });

  it('uses the route app id and service db even if body tries to override them', async () => {
    const db = { name: 'db' };
    mockGetAppPlatformService.mockReturnValue({ db });
    mockSendAppImNotification.mockResolvedValue({
      ok: true,
      appId: 'demo-app',
      status: 'sent',
    });

    const res = await POST(makeReq({
      appId: 'other-app',
      db: 'not-db',
      text: 'hello',
    }), {
      params: Promise.resolve({ id: 'demo-app' }),
    });

    expect(res.status).toBe(200);
    expect(mockSendAppImNotification).toHaveBeenCalledWith({
      appId: 'demo-app',
      db,
      text: 'hello',
    });
  });
});

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/apps/demo-app/im/notify', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}
