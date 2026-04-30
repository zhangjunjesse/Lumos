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
      message: { create: jest.fn() },
      chat: { list: jest.fn() },
    },
  })),
  Domain: { Feishu: 'feishu', Lark: 'lark' },
}));

import { FeishuMonitor } from '../monitor';
import { FeishuClient } from '../client';

function buildEvent(overrides: Partial<RawEvent> = {}): RawEvent {
  return {
    sender: { sender_type: 'user', sender_id: { open_id: 'u1' } },
    message: {
      message_id: 'm1',
      chat_id: 'c1',
      message_type: 'text',
      content: JSON.stringify({ text: 'hello' }),
      create_time: '1700000000000',
    },
    ...overrides,
  };
}

interface RawEvent {
  sender?: { sender_type?: string; sender_id?: { open_id?: string } };
  message?: {
    message_id: string;
    chat_id: string;
    message_type: string;
    content: string;
    create_time: string;
  };
}

function makeClient(): FeishuClient {
  return new FeishuClient({
    appId: 'a',
    appSecret: 'b',
    domain: 'feishu',
    redirectUri: '',
    oauthScopes: '',
  });
}

describe('feishu/monitor', () => {
  test('parses text event into InboundMessage', async () => {
    const monitor = new FeishuMonitor(makeClient());
    monitor.start();
    monitor.handleEvent(buildEvent());

    const msg = await monitor.consumeOne();
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('hello');
    expect(msg!.address.providerId).toBe('feishu');
    expect(msg!.address.chatId).toBe('c1');
    expect(msg!.address.userId).toBe('u1');
  });

  test('dedupes by message_id', async () => {
    const monitor = new FeishuMonitor(makeClient());
    monitor.start();
    monitor.handleEvent(buildEvent({ message: { ...buildEvent().message!, message_id: 'm-dup' } }));
    monitor.handleEvent(buildEvent({ message: { ...buildEvent().message!, message_id: 'm-dup' } }));

    const first = await monitor.consumeOne();
    expect(first!.messageId).toBe('m-dup');

    // Second consume should hang (no more messages); use Promise.race timeout to verify.
    const settled = await Promise.race([
      monitor.consumeOne().then(() => 'got-msg' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30)),
    ]);
    expect(settled).toBe('timeout');
    monitor.stop();
  });

  test('drops bot self-messages', async () => {
    const monitor = new FeishuMonitor(makeClient());
    monitor.start();
    monitor.handleEvent(
      buildEvent({ sender: { sender_type: 'app', sender_id: { open_id: 'app1' } } }),
    );
    const settled = await Promise.race([
      monitor.consumeOne().then(() => 'got-msg' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30)),
    ]);
    expect(settled).toBe('timeout');
    monitor.stop();
  });

  test('drops empty / whitespace text', async () => {
    const monitor = new FeishuMonitor(makeClient());
    monitor.start();
    monitor.handleEvent(
      buildEvent({
        message: {
          ...buildEvent().message!,
          content: JSON.stringify({ text: '   ' }),
        },
      }),
    );
    const settled = await Promise.race([
      monitor.consumeOne().then(() => 'got-msg' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30)),
    ]);
    expect(settled).toBe('timeout');
    monitor.stop();
  });

  test('drops non-text message types (M2 scope)', async () => {
    const monitor = new FeishuMonitor(makeClient());
    monitor.start();
    monitor.handleEvent(
      buildEvent({
        message: {
          ...buildEvent().message!,
          message_type: 'image',
          content: JSON.stringify({ image_key: 'img1' }),
        },
      }),
    );
    const settled = await Promise.race([
      monitor.consumeOne().then(() => 'got-msg' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30)),
    ]);
    expect(settled).toBe('timeout');
    monitor.stop();
  });

  test('stop returns null to pending waiters', async () => {
    const monitor = new FeishuMonitor(makeClient());
    monitor.start();
    const consumePromise = monitor.consumeOne();
    monitor.stop();
    expect(await consumePromise).toBeNull();
  });
});
