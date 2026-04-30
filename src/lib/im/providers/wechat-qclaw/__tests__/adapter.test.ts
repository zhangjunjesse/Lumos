jest.mock('ws', () => {
  const fn = jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(),
  }));
  return { __esModule: true, default: fn };
});

const fakeFetch = jest.fn();
const originalFetch = global.fetch;

import { WechatQClawAdapter } from '../adapter';
import type { QClawConfig } from '../config';

function makeConfig(overrides: Partial<QClawConfig> = {}): QClawConfig {
  return {
    qclawHost: 'http://localhost:8080',
    botId: 'b1',
    botSecret: 's1',
    transport: 'websocket',
    sendPath: '/api/send',
    eventsPath: '/api/events',
    contactsPath: '/api/contacts',
    healthPath: '/api/ping',
    ...overrides,
  };
}

beforeEach(() => {
  fakeFetch.mockReset();
  (global as { fetch: typeof fetch }).fetch = fakeFetch as unknown as typeof fetch;
});

afterAll(() => {
  (global as { fetch: typeof fetch }).fetch = originalFetch;
});

describe('wechat-qclaw/adapter: lifecycle', () => {
  test('refuses to start without bot_id/bot_secret', async () => {
    const a = new WechatQClawAdapter(makeConfig({ botId: '', botSecret: '' }));
    await expect(a.start()).rejects.toThrow(/required/);
  });

  test('isRunning toggles', async () => {
    const a = new WechatQClawAdapter(makeConfig());
    expect(a.isRunning()).toBe(false);
    await a.start();
    expect(a.isRunning()).toBe(true);
    await a.stop();
    expect(a.isRunning()).toBe(false);
  });

  test('id is wechat-qclaw', () => {
    expect(new WechatQClawAdapter(makeConfig()).id).toBe('wechat-qclaw');
  });

  test('validateConfig matches isQClawConfigValid', () => {
    expect(new WechatQClawAdapter(makeConfig()).validateConfig()).toBeNull();
    expect(new WechatQClawAdapter(makeConfig({ botSecret: '' })).validateConfig()).toMatch(/required/);
  });
});

describe('wechat-qclaw/adapter: send', () => {
  test('rejects empty chatId', async () => {
    const a = new WechatQClawAdapter(makeConfig());
    const r = await a.send({ address: { providerId: 'wechat-qclaw', chatId: '' }, text: 'hi' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/chatId required/);
  });

  test('delegates to client.sendMessage', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, messageId: 'mid' }),
    });
    const a = new WechatQClawAdapter(makeConfig());
    const r = await a.send({
      address: { providerId: 'wechat-qclaw', chatId: 'c1' },
      text: 'yo',
    });
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe('mid');
  });

  test('rejects attachments in M4 scope', async () => {
    const a = new WechatQClawAdapter(makeConfig());
    const r = await a.send({
      address: { providerId: 'wechat-qclaw', chatId: 'c1' },
      text: 'hi',
      attachments: [{ id: 'a', name: 'x.pdf', type: 'application/pdf', size: 1, data: '' }],
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/attachments not yet supported/);
  });
});

describe('wechat-qclaw/adapter: probe', () => {
  test('ok on health 2xx', async () => {
    fakeFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const r = await new WechatQClawAdapter(makeConfig()).probe();
    expect(r.ok).toBe(true);
    expect(typeof r.latencyMs).toBe('number');
  });

  test('error on health failure', async () => {
    fakeFetch.mockResolvedValueOnce({ ok: false, status: 503, json: async () => null });
    const r = await new WechatQClawAdapter(makeConfig()).probe();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/HTTP 503/);
  });
});
