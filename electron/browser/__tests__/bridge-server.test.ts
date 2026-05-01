jest.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
  },
  session: {},
}));

import { calculateBrowserContextRetryAfterMs, waitForTextScript } from '../bridge-server';
import { didNavigationReachTarget } from '../bridge-server';

describe('waitForTextScript', () => {
  const originalDocument = global.document;

  afterEach(() => {
    if (originalDocument === undefined) {
      // @ts-expect-error test cleanup for Node environment
      delete global.document;
    } else {
      global.document = originalDocument;
    }
  });

  test('matches document title when page body does not contain the target text', () => {
    global.document = {
      title: 'My Saved Items',
      body: {
        innerText: '高级筛选 收起',
        textContent: '高级筛选 收起',
      },
      documentElement: {
        innerText: '高级筛选 收起',
        textContent: '高级筛选 收起',
      },
    } as Document;

    const result = eval(waitForTextScript(['My Saved Items'])) as { found?: boolean; text?: string };
    expect(result).toEqual({
      found: true,
      text: 'my saved items',
    });
  });

  test('normalizes whitespace before matching target text', () => {
    global.document = {
      title: '',
      body: {
        innerText: '下载   信息\n选择',
        textContent: '下载   信息\n选择',
      },
      documentElement: {
        innerText: '',
        textContent: '',
      },
    } as Document;

    const result = eval(waitForTextScript(['下载 信息 选择'])) as { found?: boolean; text?: string };
    expect(result).toEqual({
      found: true,
      text: '下载 信息 选择',
    });
  });
});

describe('didNavigationReachTarget', () => {
  test('returns true when the current page URL matches the target and page content is readable', () => {
    expect(didNavigationReachTarget({
      targetUrl: 'https://www.gigab2b.com/index.php?route=account/login',
      state: {
        readyState: 'interactive',
        hasBody: true,
        textLength: 128,
        title: 'Account Login',
        url: 'https://www.gigab2b.com/index.php?route=account/login',
      },
    })).toBe(true);
  });

  test('returns false when navigation landed on a different URL', () => {
    expect(didNavigationReachTarget({
      targetUrl: 'https://www.gigab2b.com/index.php?route=account/login',
      state: {
        readyState: 'interactive',
        hasBody: true,
        textLength: 128,
        title: 'Home',
        url: 'https://www.gigab2b.com/index.php?route=common/home',
      },
    })).toBe(false);
  });
});

describe('calculateBrowserContextRetryAfterMs', () => {
  test('caps retry-after by the short lease wait window', () => {
    expect(calculateBrowserContextRetryAfterMs({
      now: 1_000,
      expiresAt: 21_000,
      maxRetryAfterMs: 10_000,
    })).toBe(10_000);
  });

  test('returns zero for an already expired lease', () => {
    expect(calculateBrowserContextRetryAfterMs({
      now: 21_000,
      expiresAt: 20_999,
      maxRetryAfterMs: 10_000,
    })).toBe(0);
  });
});
