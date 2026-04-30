jest.mock('ws', () => {
  const fn = jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(),
  }));
  return { __esModule: true, default: fn };
});

import { QClawMonitor } from '../monitor';
import { QClawClient } from '../client';
import type { QClawConfig } from '../config';

const config: QClawConfig = {
  qclawHost: 'http://localhost:8080',
  botId: 'b1',
  botSecret: 's1',
  transport: 'websocket',
  sendPath: '/api/send',
  eventsPath: '/api/events',
  contactsPath: '/api/contacts',
  healthPath: '/api/ping',
};

function makeMonitor(): QClawMonitor {
  return new QClawMonitor(new QClawClient(config), config);
}

describe('wechat-qclaw/monitor: ingestEvent', () => {
  test('queues message events for consumeOne', async () => {
    const m = makeMonitor();
    m.start();
    m.ingestEvent({ type: 'message', messageId: 'm1', chatId: 'c1', text: 'hi', timestamp: 100 });
    const inbound = await m.consumeOne();
    expect(inbound).not.toBeNull();
    expect(inbound!.text).toBe('hi');
    expect(inbound!.address.providerId).toBe('wechat-qclaw');
    expect(inbound!.address.chatId).toBe('c1');
    m.stop();
  });

  test('dedupes by messageId', async () => {
    const m = makeMonitor();
    m.start();
    m.ingestEvent({ type: 'message', messageId: 'dup', chatId: 'c', text: 'a' });
    m.ingestEvent({ type: 'message', messageId: 'dup', chatId: 'c', text: 'a' });
    const first = await m.consumeOne();
    expect(first!.messageId).toBe('dup');
    const settled = await Promise.race([
      m.consumeOne().then(() => 'got' as const),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 30)),
    ]);
    expect(settled).toBe('timeout');
    m.stop();
  });

  test('drops non-message events', async () => {
    const m = makeMonitor();
    m.start();
    m.ingestEvent({ type: 'health', timestamp: 1 });
    const settled = await Promise.race([
      m.consumeOne().then(() => 'got' as const),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 30)),
    ]);
    expect(settled).toBe('timeout');
    m.stop();
  });

  test('drops empty text', async () => {
    const m = makeMonitor();
    m.start();
    m.ingestEvent({ type: 'message', messageId: 'm', chatId: 'c', text: '   ' });
    const settled = await Promise.race([
      m.consumeOne().then(() => 'got' as const),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 30)),
    ]);
    expect(settled).toBe('timeout');
    m.stop();
  });

  test('drops events without chatId', async () => {
    const m = makeMonitor();
    m.start();
    m.ingestEvent({ type: 'message', messageId: 'm', text: 'hi' });
    const settled = await Promise.race([
      m.consumeOne().then(() => 'got' as const),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 30)),
    ]);
    expect(settled).toBe('timeout');
    m.stop();
  });

  test('stop releases pending waiter with null', async () => {
    const m = makeMonitor();
    m.start();
    const p = m.consumeOne();
    m.stop();
    expect(await p).toBeNull();
  });
});
