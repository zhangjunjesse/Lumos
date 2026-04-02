import {
  buildDeepSearchCookieImportEntries,
  parseDeepSearchCookieHeader,
} from '../cookie-source';

describe('deepsearch cookie source helpers', () => {
  it('parses cookie header values and ignores cookie attributes', () => {
    expect(parseDeepSearchCookieHeader(
      'Cookie: z_c0=token-a; d_c0=token-b; Path=/; Domain=.zhihu.com; Secure',
    )).toEqual([
      { name: 'z_c0', value: 'token-a' },
      { name: 'd_c0', value: 'token-b' },
    ]);
  });

  it('keeps the last value when cookie names repeat', () => {
    expect(parseDeepSearchCookieHeader('a=1; b=2; a=3')).toEqual([
      { name: 'a', value: '3' },
      { name: 'b', value: '2' },
    ]);
  });

  it('builds import entries against the matched root domain', () => {
    const entries = buildDeepSearchCookieImportEntries({
      baseUrl: 'https://www.zhihu.com/',
      preferredDomains: ['.zhihu.com', 'www.zhihu.com'],
      cookieHeader: 'z_c0=token-a; d_c0=token-b',
      cookieExpiresAt: '2026-04-01T00:00:00.000Z',
    });

    expect(entries).toEqual([
      expect.objectContaining({
        url: 'https://www.zhihu.com/',
        name: 'z_c0',
        value: 'token-a',
        domain: '.zhihu.com',
        path: '/',
        secure: true,
      }),
      expect.objectContaining({
        url: 'https://www.zhihu.com/',
        name: 'd_c0',
        value: 'token-b',
        domain: '.zhihu.com',
        path: '/',
        secure: true,
      }),
    ]);
    expect(entries[0]?.expirationDate).toBeGreaterThan(0);
  });

  it('avoids setting domain for __Host cookies', () => {
    const [entry] = buildDeepSearchCookieImportEntries({
      baseUrl: 'https://x.com/',
      preferredDomains: ['.x.com', 'x.com'],
      cookieHeader: '__Host-auth=token-a',
      cookieExpiresAt: null,
    });

    expect(entry).toEqual(expect.objectContaining({
      url: 'https://x.com/',
      name: '__Host-auth',
      value: 'token-a',
      path: '/',
      secure: true,
    }));
    expect(entry?.domain).toBeUndefined();
  });
});
