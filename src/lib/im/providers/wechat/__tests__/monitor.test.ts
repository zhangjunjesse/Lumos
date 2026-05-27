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

const mockTranscribeAudioAttachment = jest.fn(async () => '');
jest.mock('../../../core/speech', () => ({
  detectAudioFormat: () => ({ mime: 'audio/wav', ext: 'wav' }),
  transcribeAudioAttachment: (attachment: unknown) => mockTranscribeAudioAttachment(attachment),
}));

import { WechatMonitor } from '../monitor';
import { bodyFromItemList } from '../parse';
import { WechatClient, MESSAGE_ITEM_TEXT, MESSAGE_ITEM_VOICE, MESSAGE_TYPE_USER, MESSAGE_TYPE_BOT } from '../client';
import type { WechatConfig } from '../config';
import type { WeixinInboundMsg, MessageItem } from '../client';

const config: WechatConfig = {
  token: 'tk',
  baseUrl: 'https://x',
  accountId: 'acc',
  allowFrom: '*',
  routeTag: '',
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

function makeMonitor(client = new WechatClient({ baseUrl: config.baseUrl, token: config.token })): WechatMonitor {
  return new WechatMonitor(client, config, {
    contextTokenStore: fakeTokenStore as never,
    syncBuf: fakeBufStore,
  });
}

beforeEach(() => {
  fakeTokenStore.__m.clear();
  mockTranscribeAudioAttachment.mockClear();
  mockTranscribeAudioAttachment.mockResolvedValue('');
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
  test('does not print routine monitor logs to console by default', async () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    const m = makeMonitor();
    m.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await m.stop();

    const lines = infoSpy.mock.calls.map((call) => String(call[0] ?? ''));
    expect(lines).toEqual([]);
    expect(lines.some((line) => line.includes('POST getupdates'))).toBe(false);
    expect(lines.some((line) => line.includes('msgs=0'))).toBe(false);
    infoSpy.mockRestore();
  });

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

  test('persists camelCase contextToken from platform variants', async () => {
    const m = makeMonitor();
    m.start();
    m.ingestMessage({
      ...userMsg({ context_token: undefined }),
      contextToken: 'token-camel',
    } as WeixinInboundMsg & { contextToken: string });
    expect(m.getContextToken('alice@im.wechat')).toBe('token-camel');
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

  test('queues voice without WeChat ASR as audio placeholder instead of dropping it', async () => {
    const client = new WechatClient({ baseUrl: config.baseUrl, token: config.token });
    jest.spyOn(client, 'downloadCdnMedia').mockResolvedValue(Buffer.from('RIFF fake wav bytes'));
    const m = makeMonitor(client);
    m.start();
    await m.ingestMessage(userMsg({
      item_list: [{
        type: MESSAGE_ITEM_VOICE,
        voice_item: {
          media: {
            encrypt_query_param: 'enc-param',
            aes_key: Buffer.alloc(16).toString('base64'),
          },
        },
      }],
    }));
    const inbound = await m.consumeOne();
    expect(inbound).not.toBeNull();
    expect(inbound!.text).toMatch(/语音/);
    expect(inbound!.attachments).toHaveLength(1);
    expect(inbound!.attachments![0]).toMatchObject({
      name: 'wechat-voice-100-0.wav',
      type: 'audio/wav',
    });
    await m.stop();
  });

  test('uses local voice transcription fallback when WeChat ASR text is missing', async () => {
    mockTranscribeAudioAttachment.mockResolvedValueOnce({
      text: 'local transcript',
      empty: false,
      provider: 'mock',
    });
    const client = new WechatClient({ baseUrl: config.baseUrl, token: config.token });
    jest.spyOn(client, 'downloadCdnMedia').mockResolvedValue(Buffer.from('RIFF fake wav bytes'));
    const m = makeMonitor(client);
    m.start();
    await m.ingestMessage(userMsg({
      item_list: [{
        type: MESSAGE_ITEM_VOICE,
        voice_item: {
          media: {
            encrypt_query_param: 'enc-param',
            aes_key: Buffer.alloc(16).toString('base64'),
          },
        },
      }],
    }));
    const inbound = await m.consumeOne();
    expect(inbound).not.toBeNull();
    expect(inbound!.text).toBe('local transcript');
    expect(inbound!.attachments).toBeUndefined();
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
