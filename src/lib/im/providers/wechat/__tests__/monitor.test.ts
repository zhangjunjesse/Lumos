// Stub fetch globally so the monitor's long-poll loop receives empty results
// instead of failing & sleeping. Tests exercise ingestMessage directly.
const stubFetch = jest.fn().mockResolvedValue({
  ok: true,
  text: async () => JSON.stringify({ ret: 0, msgs: [], get_updates_buf: '' }),
});
const originalFetch = global.fetch;
beforeAll(() => {
  (global as { fetch: typeof fetch }).fetch = stubFetch as unknown as typeof fetch;
});
afterAll(() => {
  (global as { fetch: typeof fetch }).fetch = originalFetch;
});

import { WechatMonitor, bodyFromItemList } from '../monitor';
import { WechatClient, MESSAGE_ITEM_TEXT, MESSAGE_ITEM_VOICE, MESSAGE_TYPE_USER, MESSAGE_TYPE_BOT } from '../client';
import type { WechatConfig } from '../config';
import type { WeixinInboundMsg, MessageItem } from '../client';

const config: WechatConfig = {
  token: 'tk',
  baseUrl: 'https://x',
  accountId: 'acc',
  allowFrom: '*',
};

const fakeBufStore = (() => {
  let buf = '';
  return { read: () => buf, write: (b: string) => { buf = b; } };
})();
const fakeTokenStore = {
  __m: new Map<string, string>(),
  get(p: string) { return this.__m.get(p) || ''; },
  set(p: string, t: string) { this.__m.set(p, t); },
};

function makeMonitor(): WechatMonitor {
  // client unused for ingestMessage path
  const client = new WechatClient({ baseUrl: config.baseUrl, token: config.token });
  return new WechatMonitor(client, config, {
    contextTokenStore: fakeTokenStore as never,
    syncBuf: fakeBufStore,
  });
}

beforeEach(() => {
  fakeTokenStore.__m.clear();
});

function userMsg(overrides: Partial<WeixinInboundMsg> = {}): WeixinInboundMsg {
  return {
    message_id: 100,
    from_user_id: 'alice@im.wechat',
    to_user_id: 'bot@im.wechat',
    message_type: MESSAGE_TYPE_USER,
    create_time_ms: 1700000000,
    item_list: [{ type: MESSAGE_ITEM_TEXT, text_item: { text: 'hello' } }],
    context_token: 'ctx-1',
    ...overrides,
  };
}

describe('wechat/monitor: bodyFromItemList', () => {
  test('extracts plain text', () => {
    expect(bodyFromItemList([{ type: MESSAGE_ITEM_TEXT, text_item: { text: 'hi' } }])).toBe('hi');
  });

  test('extracts voice ASR transcript', () => {
    expect(
      bodyFromItemList([{ type: MESSAGE_ITEM_VOICE, voice_item: { text: 'spoken transcript' } }]),
    ).toBe('spoken transcript');
  });

  test('quoted text reply', () => {
    const items: MessageItem[] = [
      {
        type: MESSAGE_ITEM_TEXT,
        text_item: { text: 'agree' },
        ref_msg: {
          title: 'Alice',
          message_item: { type: MESSAGE_ITEM_TEXT, text_item: { text: 'hello?' } },
        },
      },
    ];
    expect(bodyFromItemList(items)).toMatch(/\[引用: Alice \| hello\?\]\nagree/);
  });

  test('returns empty for non-text-only items', () => {
    expect(bodyFromItemList([{ type: 999 }])).toBe('');
  });

  test('returns empty for empty list', () => {
    expect(bodyFromItemList([])).toBe('');
  });
});

describe('wechat/monitor: ingestMessage', () => {
  test('queues user text message', async () => {
    const m = makeMonitor();
    m.start();
    m.ingestMessage(userMsg());
    const inbound = await m.consumeOne();
    expect(inbound).not.toBeNull();
    expect(inbound!.text).toBe('hello');
    expect(inbound!.address.providerId).toBe('wechat');
    expect(inbound!.address.chatId).toBe('alice@im.wechat');
    await m.stop();
  });

  test('persists context_token to store', async () => {
    const m = makeMonitor();
    m.start();
    m.ingestMessage(userMsg({ context_token: 'token-A' }));
    expect(m.getContextToken('alice@im.wechat')).toBe('token-A');
    await m.stop();
  });

  test('ignores bot self-messages (message_type=2)', async () => {
    const m = makeMonitor();
    m.start();
    m.ingestMessage(userMsg({ message_type: MESSAGE_TYPE_BOT }));
    const settled = await Promise.race([
      m.consumeOne().then(() => 'got' as const),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 30)),
    ]);
    expect(settled).toBe('timeout');
    await m.stop();
  });

  test('respects allow_from list', async () => {
    const client = new WechatClient({ baseUrl: config.baseUrl, token: config.token });
    const restricted = new WechatMonitor(
      client,
      { ...config, allowFrom: 'bob@im.wechat' },
      { contextTokenStore: fakeTokenStore as never, syncBuf: fakeBufStore },
    );
    restricted.start();
    restricted.ingestMessage(userMsg({ from_user_id: 'alice@im.wechat' })); // not allowed
    const settled = await Promise.race([
      restricted.consumeOne().then(() => 'got' as const),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 30)),
    ]);
    expect(settled).toBe('timeout');
    await restricted.stop();
  });

  test('dedupes by message_id', async () => {
    const m = makeMonitor();
    m.start();
    m.ingestMessage(userMsg({ message_id: 42 }));
    m.ingestMessage(userMsg({ message_id: 42 }));
    const first = await m.consumeOne();
    expect(first!.messageId).toBe('42');
    const settled = await Promise.race([
      m.consumeOne().then(() => 'got' as const),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 30)),
    ]);
    expect(settled).toBe('timeout');
    await m.stop();
  });

  test('drops empty text', async () => {
    const m = makeMonitor();
    m.start();
    m.ingestMessage(userMsg({ item_list: [{ type: MESSAGE_ITEM_TEXT, text_item: { text: '' } }] }));
    const settled = await Promise.race([
      m.consumeOne().then(() => 'got' as const),
      new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 30)),
    ]);
    expect(settled).toBe('timeout');
    await m.stop();
  });

  test('stop releases pending waiter', async () => {
    const m = makeMonitor();
    m.start();
    const p = m.consumeOne();
    await m.stop();
    expect(await p).toBeNull();
  });
});
