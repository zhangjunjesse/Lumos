import {
  buildAcceptLanguage,
  buildChromeClientHints,
  buildCleanChromeUserAgent,
  normalizeChromeLikeRequestHeaders,
} from '../../../electron/browser/user-agent';

describe('browser Chrome identity helpers', () => {
  it('builds a Windows Chrome UA without Electron or Lumos tokens', () => {
    const ua = buildCleanChromeUserAgent({
      chromeVersion: '140.0.7339.207',
      platform: 'win32',
    });

    expect(ua).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.7339.207 Safari/537.36',
    );
    expect(ua).not.toContain('Electron/');
    expect(ua).not.toContain('lumos/');
  });

  it('builds Chrome-like client hints for the current Chromium major', () => {
    expect(buildChromeClientHints({
      chromeVersion: '140.0.7339.207',
      platform: 'win32',
    })).toEqual({
      'sec-ch-ua': '"Google Chrome";v="140", "Chromium";v="140", "Not_A Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    });
  });

  it('keeps Accept-Language aligned with the app locale', () => {
    expect(buildAcceptLanguage('zh-CN')).toBe('zh-CN,zh;q=0.9,en;q=0.8');
    expect(buildAcceptLanguage('en-US')).toBe('en-US,en;q=0.9');
  });

  it('normalizes stale Electron request headers case-insensitively', () => {
    const headers = normalizeChromeLikeRequestHeaders(
      {
        'user-agent': 'Mozilla/5.0 lumos/0.25.25 Chrome/140.0.0.0 Electron/40.0.0 Safari/537.36',
        'SEC-CH-UA': '"Chromium";v="140", "Electron";v="40"',
        Accept: 'text/html',
      },
      {
        chromeVersion: '140.0.7339.207',
        platform: 'win32',
        locale: 'zh-CN',
      },
    );

    expect(headers['User-Agent']).toContain('Chrome/140.0.7339.207');
    expect(headers['User-Agent']).not.toContain('Electron/');
    expect(headers['User-Agent']).not.toContain('lumos/');
    expect(headers['sec-ch-ua']).toContain('"Google Chrome";v="140"');
    expect(headers['sec-ch-ua-platform']).toBe('"Windows"');
    expect(headers['Accept-Language']).toBe('zh-CN,zh;q=0.9,en;q=0.8');
    expect(headers.Accept).toBe('text/html');
    expect(headers['user-agent']).toBeUndefined();
    expect(headers['SEC-CH-UA']).toBeUndefined();
  });
});
