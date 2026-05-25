import { resolveCreatorInput } from '../resolve-creator-input';

describe('resolveCreatorInput', () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetchUrl(finalUrl: string | null, status = 200): void {
    globalThis.fetch = jest.fn().mockResolvedValue(
      finalUrl
        ? { ok: status >= 200 && status < 300, status, url: finalUrl }
        : { ok: false, status: 404, url: '' },
    ) as unknown as typeof globalThis.fetch;
  }

  it('accepts a bare sec_uid', async () => {
    const r = await resolveCreatorInput('MS4wLjABAAAAabcdefghijklmnopqrstuvwxyz');
    expect(r).toEqual({ ok: true, secUid: 'MS4wLjABAAAAabcdefghijklmnopqrstuvwxyz' });
  });

  it('accepts a profile URL', async () => {
    const r = await resolveCreatorInput(
      'https://www.douyin.com/user/MS4wLjABAAAAabcdefghijklmnopqrstuvwxyz',
    );
    expect(r).toEqual({ ok: true, secUid: 'MS4wLjABAAAAabcdefghijklmnopqrstuvwxyz' });
  });

  it('resolves a short link that redirects to a profile URL', async () => {
    mockFetchUrl('https://www.douyin.com/user/MS4wLjABAAAAabcdefghijklmnopqrstuvwxyz');
    const r = await resolveCreatorInput('https://v.douyin.com/iAbCdEf/');
    expect(r).toEqual({ ok: true, secUid: 'MS4wLjABAAAAabcdefghijklmnopqrstuvwxyz' });
  });

  it('resolves a short link embedded in Douyin app share card text', async () => {
    mockFetchUrl('https://www.douyin.com/user/MS4wLjABAAAAabcdefghijklmnopqrstuvwxyz');
    const r = await resolveCreatorInput(
      '9- 长按复制此条消息，打开抖音搜索，查看TA的更多作品。 https://v.douyin.com/GWZM5YWSYuY/ 0@8.com :1pm',
    );
    expect(r).toEqual({ ok: true, secUid: 'MS4wLjABAAAAabcdefghijklmnopqrstuvwxyz' });
  });

  it('rejects when a short link is unreachable', async () => {
    globalThis.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ENETUNREACH')) as unknown as typeof globalThis.fetch;
    const r = await resolveCreatorInput('https://v.douyin.com/iZzZzZz/');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('short-link-unreachable');
  });

  it('rejects when a short link resolves to a video page', async () => {
    mockFetchUrl('https://www.douyin.com/video/7000000000000000001');
    const r = await resolveCreatorInput('https://v.douyin.com/iVidVid/');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('short-link-video');
  });

  it('rejects when a short link resolves to something unrecognized', async () => {
    mockFetchUrl('https://www.douyin.com/discover');
    const r = await resolveCreatorInput('https://v.douyin.com/iWeird/');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('short-link-unrecognized');
  });

  it('rejects a bare video link as not-a-creator', async () => {
    const r = await resolveCreatorInput('https://www.douyin.com/video/7000000000000000001');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('video-link');
  });

  it('rejects a plain nickname (no API path to nickname→sec_uid)', async () => {
    const r = await resolveCreatorInput('阿球哥');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('unrecognized');
  });

  it('rejects empty / whitespace input', async () => {
    const r = await resolveCreatorInput('   ');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('empty');
  });
});
