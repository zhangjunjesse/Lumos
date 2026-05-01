jest.mock('@larksuiteoapi/node-sdk', () => ({
  EventDispatcher: jest.fn().mockImplementation(() => ({
    register: jest.fn().mockReturnThis(),
  })),
  WSClient: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    close: jest.fn(),
  })),
  Client: jest.fn().mockImplementation(() => ({
    im: {
      message: {
        create: jest.fn().mockResolvedValue({ data: { message_id: 'fake-msg-id' } }),
      },
      chat: { list: jest.fn() },
    },
  })),
  Domain: { Feishu: 'feishu', Lark: 'lark' },
}));

import { FeishuAdapter } from '../adapter';
import type { FeishuConfig } from '../config';
import type { OutboundMessage } from '../../../core/types';

function makeConfig(overrides: Partial<FeishuConfig> = {}): FeishuConfig {
  return {
    appId: 'cli_x',
    appSecret: 'sec',
    domain: 'feishu',
    redirectUri: '',
    oauthScopes: '',
    ...overrides,
  };
}

describe('feishu/adapter: lifecycle', () => {
  test('refuses to start without app_id/app_secret', async () => {
    const adapter = new FeishuAdapter(makeConfig({ appId: '', appSecret: '' }));
    await expect(adapter.start()).rejects.toThrow(/required/);
  });

  test('isRunning toggles correctly', async () => {
    const adapter = new FeishuAdapter(makeConfig());
    expect(adapter.isRunning()).toBe(false);
    await adapter.start();
    expect(adapter.isRunning()).toBe(true);
    await adapter.stop();
    expect(adapter.isRunning()).toBe(false);
  });

  test('start is idempotent', async () => {
    const adapter = new FeishuAdapter(makeConfig());
    await adapter.start();
    await adapter.start();
    expect(adapter.isRunning()).toBe(true);
  });

  test('id is feishu', () => {
    expect(new FeishuAdapter(makeConfig()).id).toBe('feishu');
  });

  test('validateConfig returns null when valid', () => {
    expect(new FeishuAdapter(makeConfig()).validateConfig()).toBeNull();
  });

  test('validateConfig returns error when invalid', () => {
    expect(new FeishuAdapter(makeConfig({ appId: '' })).validateConfig()).toMatch(/required/);
  });
});

describe('feishu/adapter: send', () => {
  test('sends text via REST and returns messageId', async () => {
    const adapter = new FeishuAdapter(makeConfig());
    const msg: OutboundMessage = {
      address: { providerId: 'feishu', chatId: 'c1' },
      text: 'hello world',
    };
    const result = await adapter.send(msg);
    expect(result.ok).toBe(true);
    expect(result.messageId).toBe('fake-msg-id');
  });

  test('rejects send without chatId', async () => {
    const adapter = new FeishuAdapter(makeConfig());
    const msg: OutboundMessage = {
      address: { providerId: 'feishu', chatId: '' },
      text: 'hi',
    };
    const result = await adapter.send(msg);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/chatId required/);
  });

  test('rejects attachments in M2 scope', async () => {
    const adapter = new FeishuAdapter(makeConfig());
    const msg: OutboundMessage = {
      address: { providerId: 'feishu', chatId: 'c1' },
      text: 'with file',
      attachments: [
        { id: 'a1', name: 'x.pdf', type: 'application/pdf', size: 100, data: '' },
      ],
    };
    const result = await adapter.send(msg);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/attachments not yet supported/);
  });
});
