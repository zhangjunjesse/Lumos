import { sendOutbound } from '../send';
import { WechatClient } from '../client';

const fakeFetch = jest.fn();
const originalFetch = global.fetch;

beforeEach(() => {
  fakeFetch.mockReset();
  (global as { fetch: typeof fetch }).fetch = fakeFetch as unknown as typeof fetch;
});
afterAll(() => {
  (global as { fetch: typeof fetch }).fetch = originalFetch;
});

const client = new WechatClient({ baseUrl: 'https://x', token: 'tk' });

const makeAddr = (chatId = 'alice@im.wechat') => ({
  providerId: 'wechat',
  chatId,
});

describe('wechat/send: sendOutbound', () => {
  test('rejects empty chatId', async () => {
    const r = await sendOutbound(client, { address: makeAddr(''), text: 'hi' }, {
      getContextToken: () => 'ctx',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/chatId/);
  });

  test('rejects when no context_token in store', async () => {
    const r = await sendOutbound(client, { address: makeAddr(), text: 'hi' }, {
      getContextToken: () => '',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/context_token/);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  test('rejects empty text', async () => {
    const r = await sendOutbound(client, { address: makeAddr(), text: '   ' }, {
      getContextToken: () => 'ctx',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/);
  });

  test('sends text with context_token', async () => {
    fakeFetch.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ ret: 0 }) });
    const r = await sendOutbound(client, { address: makeAddr(), text: 'hello' }, {
      getContextToken: () => 'ctx-1',
    });
    expect(r.ok).toBe(true);
    expect(r.messageId).toBeTruthy();
    const [, init] = fakeFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.msg.context_token).toBe('ctx-1');
    expect(body.msg.item_list[0].text_item.text).toBe('hello');
  });

  test('splits long text into chunks', async () => {
    fakeFetch.mockResolvedValue({ ok: true, text: async () => JSON.stringify({ ret: 0 }) });
    const long = 'x'.repeat(8000); // > MAX_CHUNK 3800 → 3 chunks
    const r = await sendOutbound(client, { address: makeAddr(), text: long }, {
      getContextToken: () => 'ctx',
    });
    expect(r.ok).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(3);
  });

  test('retries once on ret=-2', async () => {
    fakeFetch
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ ret: -2, errmsg: 'expired' }) })
      .mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify({ ret: 0 }) });
    const r = await sendOutbound(client, { address: makeAddr(), text: 'hi' }, {
      getContextToken: () => 'ctx',
    });
    expect(r.ok).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  test('attachments rejected (M+1)', async () => {
    const r = await sendOutbound(
      client,
      {
        address: makeAddr(),
        text: 'hi',
        attachments: [{ id: 'a', name: 'x.pdf', type: 'application/pdf', size: 1, data: '' }],
      },
      { getContextToken: () => 'ctx' },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/attachments/);
  });
});
