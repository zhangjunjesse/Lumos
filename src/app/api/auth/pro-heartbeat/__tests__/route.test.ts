import { NextRequest } from 'next/server';

// Mock all DB / auth helpers before importing the route under test.
jest.mock('@/lib/db/connection', () => ({ getDb: jest.fn() }));
jest.mock('@/lib/auth/session', () => ({ destroySession: jest.fn() }));
jest.mock('@/lib/auth/user-service', () => ({ getUserBySession: jest.fn() }));

import { getDb } from '@/lib/db/connection';
import { destroySession } from '@/lib/auth/session';
import { getUserBySession } from '@/lib/auth/user-service';
import { GET } from '../route';

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetUserBySession = getUserBySession as jest.MockedFunction<typeof getUserBySession>;
const mockedDestroySession = destroySession as jest.MockedFunction<typeof destroySession>;

function makeReq(cookie?: string): NextRequest {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return new NextRequest('http://localhost/api/auth/pro-heartbeat', { headers });
}

function stubDbWithToken(webToken: string | null): void {
  const row = webToken === null ? undefined : { web_session_token: webToken };
  mockedGetDb.mockReturnValue({
    prepare: () => ({ get: () => row }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

const VALID_TOKEN = 'a'.repeat(64); // 64 hex chars

describe('pro-heartbeat route', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  test('no session cookie → valid:false no_session', async () => {
    const res = await GET(makeReq());
    expect(await res.json()).toEqual({ valid: false, reason: 'no_session' });
  });

  test('local session expired → valid:false local_expired', async () => {
    mockedGetUserBySession.mockReturnValue(null);
    const res = await GET(makeReq('lumos_session=abc'));
    expect(await res.json()).toEqual({ valid: false, reason: 'local_expired' });
  });

  test('no web_session_token on user → valid:true no_web_token (no kick)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedGetUserBySession.mockReturnValue({ id: 'u1' } as any);
    stubDbWithToken('');
    const res = await GET(makeReq('lumos_session=abc'));
    expect(await res.json()).toEqual({ valid: true, reason: 'no_web_token' });
    expect(mockedDestroySession).not.toHaveBeenCalled();
  });

  test('malformed web_session_token → valid:true malformed_token, no fetch', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedGetUserBySession.mockReturnValue({ id: 'u1' } as any);
    stubDbWithToken('not-hex\r\ninjection');
    const spy = jest.fn();
    global.fetch = spy as unknown as typeof fetch;

    const res = await GET(makeReq('lumos_session=abc'));
    expect(await res.json()).toEqual({ valid: true, reason: 'malformed_token' });
    expect(spy).not.toHaveBeenCalled();
    expect(mockedDestroySession).not.toHaveBeenCalled();
  });

  test('lumos-web 401 → valid:false kicked, destroys local session', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedGetUserBySession.mockReturnValue({ id: 'u1' } as any);
    stubDbWithToken(VALID_TOKEN);
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: '未登录' }), { status: 401 }),
    ) as unknown as typeof fetch;

    const res = await GET(makeReq('lumos_session=abc'));
    expect(await res.json()).toEqual({ valid: false, reason: 'kicked' });
    expect(mockedDestroySession).toHaveBeenCalledWith('abc');
  });

  test('lumos-web 5xx → valid:true inconclusive, does NOT destroy session', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedGetUserBySession.mockReturnValue({ id: 'u1' } as any);
    stubDbWithToken(VALID_TOKEN);
    global.fetch = jest.fn().mockResolvedValue(
      new Response('bad gateway', { status: 502 }),
    ) as unknown as typeof fetch;

    const res = await GET(makeReq('lumos_session=abc'));
    expect(await res.json()).toEqual({ valid: true, reason: 'inconclusive' });
    expect(mockedDestroySession).not.toHaveBeenCalled();
  });

  test('network error → valid:true network_error, does NOT destroy session', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedGetUserBySession.mockReturnValue({ id: 'u1' } as any);
    stubDbWithToken(VALID_TOKEN);
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    const res = await GET(makeReq('lumos_session=abc'));
    expect(await res.json()).toEqual({ valid: true, reason: 'network_error' });
    expect(mockedDestroySession).not.toHaveBeenCalled();
  });

  test('lumos-web 200 success → valid:true', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockedGetUserBySession.mockReturnValue({ id: 'u1' } as any);
    stubDbWithToken(VALID_TOKEN);
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }),
    ) as unknown as typeof fetch;

    const res = await GET(makeReq('lumos_session=abc'));
    expect(await res.json()).toEqual({ valid: true });
    expect(mockedDestroySession).not.toHaveBeenCalled();
  });
});
