import { WechatWorkClient } from '../client';
import type { WechatWorkConfig } from '../config';

const fakeFetch = jest.fn();
const originalFetch = global.fetch;

const baseConfig: WechatWorkConfig = {
  corpId: 'ww1',
  agentId: '1000002',
  corpSecret: 'sec',
  callbackToken: '',
  callbackAesKey: '',
  apiBase: 'https://qyapi.weixin.qq.com',
};

beforeEach(() => {
  fakeFetch.mockReset();
  (global as { fetch: typeof fetch }).fetch = fakeFetch as unknown as typeof fetch;
});

afterAll(() => {
  (global as { fetch: typeof fetch }).fetch = originalFetch;
});

describe('wechat-work/client: token + send', () => {
  test('first call fetches access_token then sends', async () => {
    fakeFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tk1', expires_in: 7200, errcode: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ errcode: 0, msgid: 'mid' }),
      });

    const client = new WechatWorkClient(baseConfig);
    const result = await client.sendText('user1', 'hi');
    expect(result.messageId).toBe('mid');
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    const tokenUrl = new URL(fakeFetch.mock.calls[0][0]);
    expect(tokenUrl.pathname).toBe('/cgi-bin/gettoken');
    expect(tokenUrl.searchParams.get('corpid')).toBe('ww1');
    const sendCall = fakeFetch.mock.calls[1];
    expect(String(sendCall[0])).toContain('/cgi-bin/message/send');
    expect(JSON.parse(sendCall[1].body)).toEqual({
      touser: 'user1',
      msgtype: 'text',
      agentid: 1000002,
      text: { content: 'hi' },
    });
  });

  test('caches token across calls', async () => {
    fakeFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tk1', expires_in: 7200 }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ errcode: 0, msgid: 'm1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ errcode: 0, msgid: 'm2' }) });

    const client = new WechatWorkClient(baseConfig);
    await client.sendText('u1', 'a');
    await client.sendText('u2', 'b');
    expect(fakeFetch).toHaveBeenCalledTimes(3); // 1 token + 2 sends
  });

  test('rejects send when message API errors', async () => {
    fakeFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'tk', expires_in: 7200 }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ errcode: 40003, errmsg: 'invalid userid' }),
      });

    const result = await new WechatWorkClient(baseConfig).sendText('bad', 'x');
    expect(result.error).toBe('invalid userid');
    expect(result.messageId).toBeUndefined();
  });

  test('probeCredentials true on token success', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'tk', expires_in: 7200 }),
    });
    const r = await new WechatWorkClient(baseConfig).probeCredentials();
    expect(r.ok).toBe(true);
  });

  test('probeCredentials surfaces token errmsg', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errcode: 60011, errmsg: 'permission denied' }),
    });
    const r = await new WechatWorkClient(baseConfig).probeCredentials();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/permission denied/);
  });
});
