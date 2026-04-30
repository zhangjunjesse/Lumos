import { fetchBotQRCode, pollQRStatus } from '../setup';

const fakeFetch = jest.fn();
const originalFetch = global.fetch;

beforeEach(() => {
  fakeFetch.mockReset();
  (global as { fetch: typeof fetch }).fetch = fakeFetch as unknown as typeof fetch;
});
afterAll(() => {
  (global as { fetch: typeof fetch }).fetch = originalFetch;
});

describe('wechat/setup: fetchBotQRCode', () => {
  test('GETs /ilink/bot/get_bot_qrcode with bot_type', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ qrcode: 'key1', qrcode_img_content: 'https://qr.x' }),
    });
    const r = await fetchBotQRCode();
    expect(r.qrcode).toBe('key1');
    expect(r.qrcode_img_content).toBe('https://qr.x');
    const [url, init] = fakeFetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.hostname).toBe('ilinkai.weixin.qq.com');
    expect(parsed.pathname).toBe('/ilink/bot/get_bot_qrcode');
    expect(parsed.searchParams.get('bot_type')).toBe('3');
    expect(init.headers['iLink-App-ClientVersion']).toBe('1');
  });

  test('respects custom apiBase / botType', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ qrcode: 'k', qrcode_img_content: 'u' }),
    });
    await fetchBotQRCode({ apiBase: 'https://custom', botType: '5' });
    const url = new URL(fakeFetch.mock.calls[0][0]);
    expect(url.hostname).toBe('custom');
    expect(url.searchParams.get('bot_type')).toBe('5');
  });

  test('rejects when qrcode_img_content missing', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ qrcode: 'k' }),
    });
    await expect(fetchBotQRCode()).rejects.toThrow(/empty qrcode_img_content/);
  });

  test('rejects on HTTP error', async () => {
    fakeFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'oops' });
    await expect(fetchBotQRCode()).rejects.toThrow(/HTTP 500/);
  });
});

describe('wechat/setup: pollQRStatus', () => {
  test('returns wait status when server says wait', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'wait' }),
    });
    const r = await pollQRStatus('key1');
    expect(r.status).toBe('wait');
  });

  test('returns confirmed with token + base_url', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'confirmed',
        bot_token: 'tk-x',
        ilink_bot_id: 'bot-1',
        baseurl: 'https://server-assigned.weixin',
        ilink_user_id: 'user-1',
      }),
    });
    const r = await pollQRStatus('key1');
    expect(r.status).toBe('confirmed');
    expect(r.bot_token).toBe('tk-x');
    expect(r.baseurl).toBe('https://server-assigned.weixin');
  });

  test('treats abort as wait status', async () => {
    fakeFetch.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );
    const r = await pollQRStatus('key1');
    expect(r.status).toBe('wait');
  });

  test('throws on non-200', async () => {
    fakeFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'oops',
    });
    await expect(pollQRStatus('key1')).rejects.toThrow(/HTTP 500/);
  });
});
