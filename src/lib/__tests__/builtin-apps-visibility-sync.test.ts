// In-memory mocks for the DB and the local visibility helpers so the test
// can run without SQLite or a real lumos-web server.
const settingsStore = new Map<string, string>();
const dbStore: { web_session_token: string | null } = { web_session_token: null };

jest.mock('@/lib/db', () => ({
  getSetting: (key: string) => settingsStore.get(key),
  setSetting: (key: string, value: string) => { settingsStore.set(key, value); },
}));

jest.mock('@/lib/db/connection', () => ({
  getDb: () => ({
    prepare: () => ({
      get: () => ({ web_session_token: dbStore.web_session_token }),
    }),
  }),
}));

const HEX_TOKEN = 'a'.repeat(64);

import { refreshServerHiddenAppIds } from '../builtin-apps-visibility-sync';
import { getServerHiddenAppIds } from '../builtin-apps-visibility';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  settingsStore.clear();
  dbStore.web_session_token = null;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = impl as unknown as typeof fetch;
}

describe('refreshServerHiddenAppIds', () => {
  it('returns no_web_session when user has no token stored', async () => {
    const res = await refreshServerHiddenAppIds('user-1');
    expect(res).toEqual({ ok: false, reason: 'no_web_session' });
  });

  it('returns no_web_session when token is malformed (not 64 hex)', async () => {
    dbStore.web_session_token = 'not-hex-not-64-chars-but-something';
    const res = await refreshServerHiddenAppIds('user-1');
    expect(res).toEqual({ ok: false, reason: 'no_web_session' });
  });

  it('returns unauthenticated on 401 without writing cache', async () => {
    dbStore.web_session_token = HEX_TOKEN;
    mockFetch(async () => new Response('', { status: 401 }));
    settingsStore.set('builtin_apps_hidden_server', JSON.stringify(['wechat-assistant']));
    const res = await refreshServerHiddenAppIds('user-1');
    expect(res).toEqual({ ok: false, reason: 'unauthenticated' });
    // Cache untouched: previous hide list still there.
    expect(getServerHiddenAppIds()).toEqual(['wechat-assistant']);
  });

  it('returns http_5xx on server error and keeps the cache', async () => {
    dbStore.web_session_token = HEX_TOKEN;
    mockFetch(async () => new Response('', { status: 503 }));
    settingsStore.set('builtin_apps_hidden_server', JSON.stringify(['ecommerce-assistant']));
    const res = await refreshServerHiddenAppIds('user-1');
    expect(res).toEqual({ ok: false, reason: 'http_503' });
    expect(getServerHiddenAppIds()).toEqual(['ecommerce-assistant']);
  });

  it('returns malformed when payload has no success/data', async () => {
    dbStore.web_session_token = HEX_TOKEN;
    mockFetch(async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 }));
    const res = await refreshServerHiddenAppIds('user-1');
    expect(res).toEqual({ ok: false, reason: 'malformed' });
  });

  it('writes hidden array from data.hidden when present', async () => {
    dbStore.web_session_token = HEX_TOKEN;
    mockFetch(async () => new Response(
      JSON.stringify({ success: true, data: { hidden: ['wechat-assistant', 'ecommerce-assistant', 'unknown-app'] } }),
      { status: 200 },
    ));
    const res = await refreshServerHiddenAppIds('user-1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.hidden).toEqual(['ecommerce-assistant', 'wechat-assistant']);
    }
    expect(getServerHiddenAppIds()).toEqual(['ecommerce-assistant', 'wechat-assistant']);
  });

  it('falls back to data.apps when data.hidden is absent', async () => {
    dbStore.web_session_token = HEX_TOKEN;
    mockFetch(async () => new Response(
      JSON.stringify({
        success: true,
        data: {
          apps: [
            { id: 'wechat-assistant', hidden: true },
            { id: 'goofish-assistant', hidden: false },
            { id: 'ecommerce-assistant', hidden: true },
          ],
        },
      }),
      { status: 200 },
    ));
    const res = await refreshServerHiddenAppIds('user-1');
    expect(res.ok).toBe(true);
    expect(getServerHiddenAppIds()).toEqual(['ecommerce-assistant', 'wechat-assistant']);
  });

  it('returns network_error when fetch throws and keeps the cache', async () => {
    dbStore.web_session_token = HEX_TOKEN;
    mockFetch(async () => { throw new Error('boom'); });
    settingsStore.set('builtin_apps_hidden_server', JSON.stringify(['wechat-assistant']));
    const res = await refreshServerHiddenAppIds('user-1');
    expect(res).toEqual({ ok: false, reason: 'boom' });
    expect(getServerHiddenAppIds()).toEqual(['wechat-assistant']);
  });
});
