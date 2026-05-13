import { resolveShortLink } from '../scraper';

describe('resolveShortLink', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns final URL after redirect when fetch resolves OK', async () => {
    // Native Response has a read-only `url` getter; build a plain object
    // that exposes only the fields resolveShortLink actually reads.
    const fakeResponse = {
      ok: true,
      status: 200,
      url: 'https://www.douyin.com/video/7000000000000000001',
    };
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(fakeResponse) as unknown as typeof globalThis.fetch;
    const r = await resolveShortLink('iAbCdEf');
    expect(r).toBe('https://www.douyin.com/video/7000000000000000001');
  });

  it('returns null on non-2xx status (and not 302)', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(new Response('', { status: 404 })) as unknown as typeof globalThis.fetch;
    expect(await resolveShortLink('badtoken')).toBeNull();
  });

  it('returns null on network error', async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ENETUNREACH')) as unknown as typeof globalThis.fetch;
    expect(await resolveShortLink('whatever')).toBeNull();
  });

  it('encodes the short token in the URL (handles unsafe chars)', async () => {
    let receivedUrl = '';
    globalThis.fetch = jest.fn(async (input: RequestInfo | URL) => {
      receivedUrl = typeof input === 'string' ? input : input.toString();
      return {
        ok: true,
        status: 200,
        url: 'https://www.douyin.com/video/foo',
      } as unknown as Response;
    }) as unknown as typeof globalThis.fetch;
    await resolveShortLink('a/b?c');
    expect(receivedUrl).toContain('https://v.douyin.com/');
    // unsafe chars must be percent-encoded
    expect(receivedUrl).not.toContain('a/b?c');
  });
});
