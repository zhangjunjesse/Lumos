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

const baseOpts = {
  baseUrl: 'https://ilinkai.weixin.qq.com',
  token: 'tk-1',
};

describe('wechat/client: getUpdates', () => {
  test('POSTs to /ilink/bot/getupdates with Bearer + iLink-App-ClientVersion', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ ret: 0, msgs: [], get_updates_buf: 'cursor-1' }),
    });
    const client = new WechatClient(baseOpts);
    const r = await client.getUpdates('');
    expect(r.ret).toBe(0);
    expect(r.get_updates_buf).toBe('cursor-1');
    const [url, init] = fakeFetch.mock.calls[0];
    expect(url).toBe('https://ilinkai.weixin.qq.com/ilink/bot/getupdates');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.get_updates_buf).toBe('');
    expect(body.base_info.channel_version).toMatch(/lumos-wechat/);
    expect(init.headers.Authorization).toBe('Bearer tk-1');
    expect(init.headers['iLink-App-ClientVersion']).toBe('1');
  });

  test('handles HTTP error', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
    });
    const client = new WechatClient(baseOpts);
    await expect(client.getUpdates('')).rejects.toThrow(/HTTP 401/);
  });

  test('treats abort as empty result (long-poll timeout)', async () => {
    fakeFetch.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    const r = await new WechatClient(baseOpts).getUpdates('cursor-x');
    expect(r.ret).toBe(0);
    expect(r.msgs).toEqual([]);
    expect(r.get_updates_buf).toBe('cursor-x');
  });
});

describe('wechat/client: sendText', () => {
  test('rejects without context_token', async () => {
    const r = await new WechatClient(baseOpts).sendText({
      toUserId: 'u',
      text: 'hi',
      contextToken: '',
      clientId: 'c1',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/context_token required/);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  test('POSTs sendmessage with proper outbound shape', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ ret: 0 }),
    });
    const r = await new WechatClient(baseOpts).sendText({
      toUserId: 'peer@im.wechat',
      text: 'hello',
      contextToken: 'ctx-123',
      clientId: 'cid-1',
    });
    expect(r.ok).toBe(true);
    const [, init] = fakeFetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.msg.to_user_id).toBe('peer@im.wechat');
    expect(body.msg.context_token).toBe('ctx-123');
    expect(body.msg.client_id).toBe('cid-1');
    expect(body.msg.message_type).toBe(2);
    expect(body.msg.message_state).toBe(2);
    expect(body.msg.item_list[0].text_item.text).toBe('hello');
  });

  test('returns ret on send failure', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ ret: -2, errcode: 100, errmsg: 'session expired' }),
    });
    const r = await new WechatClient(baseOpts).sendText({
      toUserId: 'u',
      text: 'x',
      contextToken: 'ctx',
      clientId: 'c',
    });
    expect(r.ok).toBe(false);
    expect(r.ret).toBe(-2);
    expect(r.error).toMatch(/session expired/);
  });
});

describe('wechat/client: verifyToken', () => {
  test('returns ok=true on ret=0', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ ret: 0, msgs: [], get_updates_buf: '' }),
    });
    const r = await new WechatClient(baseOpts).verifyToken();
    expect(r.ok).toBe(true);
  });

  test('returns ok=false on non-zero ret', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ ret: -1, errmsg: 'bad token' }),
    });
    const r = await new WechatClient(baseOpts).verifyToken();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/bad token/);
  });

  test('returns ok=false on HTTP error', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'oops',
    });
    const r = await new WechatClient(baseOpts).verifyToken();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/HTTP 500/);
  });
});

describe('wechat/client: SKRouteTag header', () => {
  test('included when configured', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ ret: 0, msgs: [], get_updates_buf: '' }),
    });
    await new WechatClient({ ...baseOpts, routeTag: 'route-1' }).getUpdates('');
    const [, init] = fakeFetch.mock.calls[0];
    expect(init.headers.SKRouteTag).toBe('route-1');
  });
});
