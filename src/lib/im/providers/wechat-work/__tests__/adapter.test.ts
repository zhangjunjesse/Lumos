const fakeFetch = jest.fn();
const originalFetch = global.fetch;

import { WechatWorkAdapter } from '../adapter';
import type { WechatWorkConfig } from '../config';

function makeConfig(overrides: Partial<WechatWorkConfig> = {}): WechatWorkConfig {
  return {
    corpId: 'ww1',
    agentId: '1000002',
    corpSecret: 'sec',
    callbackToken: '',
    callbackAesKey: '',
    apiBase: 'https://qyapi.weixin.qq.com',
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

describe('wechat-work/adapter: lifecycle', () => {
  test('refuses to start without required fields', async () => {
    const a = new WechatWorkAdapter(makeConfig({ corpSecret: '' }));
    await expect(a.start()).rejects.toThrow(/required/);
  });

  test('isRunning toggles', async () => {
    const a = new WechatWorkAdapter(makeConfig());
    expect(a.isRunning()).toBe(false);
    await a.start();
    expect(a.isRunning()).toBe(true);
    await a.stop();
    expect(a.isRunning()).toBe(false);
  });

  test('id is wechat-work', () => {
    expect(new WechatWorkAdapter(makeConfig()).id).toBe('wechat-work');
  });
});

describe('wechat-work/adapter: send + probe', () => {
  test('send delegates to client (token then send)', async () => {
    fakeFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tk', expires_in: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ errcode: 0, msgid: 'mid' }),
      });

    const r = await new WechatWorkAdapter(makeConfig()).send({
      address: { providerId: 'wechat-work', chatId: 'userA' },
      text: 'yo',
    });
    expect(r.ok).toBe(true);
    expect(r.messageId).toBe('mid');
  });

  test('send rejects empty chatId', async () => {
    const r = await new WechatWorkAdapter(makeConfig()).send({
      address: { providerId: 'wechat-work', chatId: '' },
      text: 'x',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/chatId required/);
  });

  test('probe ok on token success', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tk', expires_in: 7200 }),
    });
    const r = await new WechatWorkAdapter(makeConfig()).probe();
    expect(r.ok).toBe(true);
  });
});

describe('wechat-work/adapter: monitor stub', () => {
  test('consumeOne pending until ingestEvent (via stop returns null)', async () => {
    const a = new WechatWorkAdapter(makeConfig());
    await a.start();
    const consumePromise = a.consumeOne();
    await a.stop();
    expect(await consumePromise).toBeNull();
  });
});
