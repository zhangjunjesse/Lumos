const fakeFetch = jest.fn();
const originalFetch = global.fetch;

import { WechatAdapter } from '../adapter';
import type { WechatConfig } from '../config';

function makeConfig(overrides: Partial<WechatConfig> = {}): WechatConfig {
  return {
    token: 'tk',
    baseUrl: 'https://x',
    accountId: 'acc',
    allowFrom: '*',
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

describe('wechat/adapter: lifecycle', () => {
  test('refuses to start without token', async () => {
    const a = new WechatAdapter(makeConfig({ token: '' }));
    await expect(a.start()).rejects.toThrow(/token is required/);
  });

  test('id is wechat', () => {
    expect(new WechatAdapter(makeConfig()).id).toBe('wechat');
  });

  test('isRunning toggles after start/stop (long-poll loop kept short via failure path)', async () => {
    fakeFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'err',
    });
    const a = new WechatAdapter(makeConfig());
    expect(a.isRunning()).toBe(false);
    await a.start();
    expect(a.isRunning()).toBe(true);
    await a.stop();
    expect(a.isRunning()).toBe(false);
  });

  test('validateConfig matches isWechatConfigValid', () => {
    expect(new WechatAdapter(makeConfig()).validateConfig()).toBeNull();
    expect(new WechatAdapter(makeConfig({ token: '' })).validateConfig()).toMatch(/token/);
  });
});

describe('wechat/adapter: probe', () => {
  test('probe ok on getUpdates ret=0', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ ret: 0, msgs: [], get_updates_buf: '' }),
    });
    const r = await new WechatAdapter(makeConfig()).probe();
    expect(r.ok).toBe(true);
    expect(typeof r.latencyMs).toBe('number');
  });

  test('probe error on bad token', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ ret: -1, errmsg: 'token invalid' }),
    });
    const r = await new WechatAdapter(makeConfig()).probe();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/token invalid/);
  });
});

describe('wechat/adapter: send delegation', () => {
  test('send rejects when no context_token in store', async () => {
    const r = await new WechatAdapter(makeConfig()).send({
      address: { providerId: 'wechat', chatId: 'peer@im.wechat' },
      text: 'hi',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/context_token/);
  });
});

describe('wechat/adapter: command handler', () => {
  test('listCommands returns built-in commands', () => {
    const cmds = new WechatAdapter(makeConfig()).listCommands();
    expect(cmds.find((c) => c.name === 'ping')).toBeDefined();
    expect(cmds.find((c) => c.name === 'help')).toBeDefined();
  });

  test('handleCommand returns ping reply', async () => {
    const a = new WechatAdapter(makeConfig());
    const result = await a.handleCommand({
      command: 'ping',
      args: [],
      message: {
        messageId: 'm',
        address: { providerId: 'wechat', chatId: 'p', userId: 'p' },
        text: '/ping',
        timestamp: 1,
      },
    });
    expect(result.handled).toBe(true);
    expect(result.reply?.text).toBe('pong');
  });
});
