jest.mock('@/lib/auth/user-service', () => ({
  getActiveUserId: jest.fn(() => null),
  getActiveWebSessionToken: jest.fn(() => 'cloud-session-token'),
}));

jest.mock('@/lib/db', () => ({
  getSetting: jest.fn(() => ''),
}));

jest.mock('@/lib/db/connection', () => ({
  getDb: jest.fn(),
}));

import { getActiveWebSessionToken } from '@/lib/auth/user-service';
import { getSetting } from '@/lib/db';
import { submitLumosBugIssue } from '../issue-reporter';

const mockedGetActiveWebSessionToken = getActiveWebSessionToken as jest.MockedFunction<typeof getActiveWebSessionToken>;
const mockedGetSetting = getSetting as jest.MockedFunction<typeof getSetting>;

describe('lumos issue reporter cloud transport', () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.LUMOS_WEB_URL;

  afterEach(() => {
    global.fetch = originalFetch;
    mockedGetActiveWebSessionToken.mockReturnValue('cloud-session-token');
    mockedGetSetting.mockReturnValue('');
    if (originalEnv == null) {
      delete process.env.LUMOS_WEB_URL;
    } else {
      process.env.LUMOS_WEB_URL = originalEnv;
    }
  });

  test('prefers Lumos Cloud issue proxy when a web session token is available', async () => {
    process.env.LUMOS_WEB_URL = 'https://lumos.example.test';
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({
      success: true,
      data: {
        issueNumber: 77,
        issueUrl: 'https://github.com/zhangjunjesse/Lumos/issues/77',
        repository: 'zhangjunjesse/Lumos',
        labelsApplied: ['bug', 'severity:high'],
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    global.fetch = fetchMock as typeof fetch;

    const result = await submitLumosBugIssue({
      title: 'cloud issue proxy smoke',
      actualBehavior: 'Issue reporter should use the Lumos Cloud proxy.',
      severity: 'high',
      confirmedByUser: true,
    }, {
      reporter: { id: 'u1', email: 'zj391504704@gmail.com' },
    });

    expect(result.issueUrl).toBe('https://github.com/zhangjunjesse/Lumos/issues/77');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://lumos.example.test/api/desktop/issues/lumos-bug');
    expect(init.headers).toEqual(expect.objectContaining({
      Authorization: 'Bearer cloud-session-token',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }));
    expect(JSON.parse(String(init.body))).toEqual(expect.objectContaining({
      repository: 'zhangjunjesse/Lumos',
      title: '[Bug] cloud issue proxy smoke',
    }));
  });
});
