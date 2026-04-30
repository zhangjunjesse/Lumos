import { QClawClient } from '../client';
import type { QClawConfig } from '../config';

const fakeFetch = jest.fn();
const originalFetch = global.fetch;

const baseConfig: QClawConfig = {
  qclawHost: 'http://qclaw.local:8080',
  botId: 'bot1',
  botSecret: 'sec1',
  transport: 'websocket',
  sendPath: '/api/send',
  eventsPath: '/api/events',
  contactsPath: '/api/contacts',
  healthPath: '/api/ping',
};

beforeEach(() => {
  fakeFetch.mockReset();
  (global as { fetch: typeof fetch }).fetch = fakeFetch as unknown as typeof fetch;
});

afterAll(() => {
  (global as { fetch: typeof fetch }).fetch = originalFetch;
});

describe('wechat-qclaw/client: sendMessage', () => {
  test('POSTs to correct URL with auth header', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, messageId: 'mid' }),
    });
    const client = new QClawClient(baseConfig);
    const result = await client.sendMessage({ chatId: 'c1', text: 'hi' });
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('mid');
    const [url, init] = fakeFetch.mock.calls[0];
    expect(url).toBe('http://qclaw.local:8080/api/send');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ chatId: 'c1', text: 'hi' });
    expect(init.headers.Authorization).toBe('Bearer sec1');
    expect(init.headers['X-QClaw-Bot-Id']).toBe('bot1');
  });

  test('returns error on non-ok response', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
    });
    const result = await new QClawClient(baseConfig).sendMessage({ chatId: 'c', text: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
  });

  test('catches network exception', async () => {
    fakeFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const result = await new QClawClient(baseConfig).sendMessage({ chatId: 'c', text: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });
});

describe('wechat-qclaw/client: listContacts', () => {
  test('GETs with query and limit', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ contacts: [{ id: '1', name: 'Alice', kind: 'direct' }] }),
    });
    const list = await new QClawClient(baseConfig).listContacts('Ali', 10);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Alice');
    const [url] = fakeFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/api/contacts');
    expect(parsed.searchParams.get('q')).toBe('Ali');
    expect(parsed.searchParams.get('limit')).toBe('10');
  });

  test('returns empty on non-ok', async () => {
    fakeFetch.mockResolvedValueOnce({ ok: false, json: async () => null });
    expect(await new QClawClient(baseConfig).listContacts()).toEqual([]);
  });
});

describe('wechat-qclaw/client: probeHealth', () => {
  test('returns ok on 2xx', async () => {
    fakeFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    expect(await new QClawClient(baseConfig).probeHealth()).toEqual({ ok: true });
  });

  test('returns error on non-2xx', async () => {
    fakeFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => null });
    const r = await new QClawClient(baseConfig).probeHealth();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/HTTP 503/);
  });
});

describe('wechat-qclaw/client: buildEventsWsUrl', () => {
  test('http→ws scheme rewrite + query params', () => {
    const url = new QClawClient(baseConfig).buildEventsWsUrl();
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('ws:');
    expect(parsed.pathname).toBe('/api/events');
    expect(parsed.searchParams.get('bot_id')).toBe('bot1');
    expect(parsed.searchParams.get('token')).toBe('sec1');
  });

  test('https→wss scheme rewrite', () => {
    const url = new QClawClient({ ...baseConfig, qclawHost: 'https://qclaw.example' }).buildEventsWsUrl();
    expect(url.startsWith('wss://')).toBe(true);
  });
});
