const fakeFetch = jest.fn();
const originalFetch = global.fetch;

// adapter.ts now transitively imports commands.ts → @/lib/db. Mock to keep tests fast/light.
jest.mock('@/lib/db', () => ({
  getAllSessions: () => [],
  getSession: () => undefined,
  createSession: (title?: string) => ({
    id: 'fake-session',
    title: title || 'New Chat',
    status: 'active',
    updated_at: new Date().toISOString().replace('T', ' ').split('.')[0],
  }),
  getSetting: () => undefined,
  setSetting: () => undefined,
}));

import { WechatAdapter } from '../adapter';
import type { WechatConfig } from '../config';

function makeConfig(overrides: Partial<WechatConfig> = {}): WechatConfig {
  return {
    token: 'tk',
    baseUrl: 'https://x',
    accountId: 'acc',
    allowFrom: '*',
    routeTag: '',
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

describe('wechat/adapter: command metadata', () => {
  test('listCommands returns built-in + wechat commands', () => {
    const cmds = new WechatAdapter(makeConfig()).listCommands();
    expect(cmds.find((c) => c.name === 'ping')).toBeDefined();
    expect(cmds.find((c) => c.name === 'help')).toBeDefined();
    expect(cmds.find((c) => c.name === 'list')).toBeDefined();
    expect(cmds.find((c) => c.name === 'switch')).toBeDefined();
    expect(cmds.find((c) => c.name === 'new')).toBeDefined();
  });

  test('handleCommand is a stub (real dispatch lives in im-inbound-dispatcher)', async () => {
    // adapter 在 electron 主进程也会被实例化，那侧不能拉 DB。
    // 命令实际分派由 Next.js 侧的 dispatchInbound 完成。
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
    expect(result.handled).toBe(false);
  });
});
