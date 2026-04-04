const mockResolveBrowserBridgeRuntimeConfig = jest.fn();
const mockPostToBrowserBridge = jest.fn();
const mockGetFromBrowserBridge = jest.fn();

jest.mock('@/lib/browser-runtime/bridge-client', () => ({
  resolveBrowserBridgeRuntimeConfig: (...args: unknown[]) => mockResolveBrowserBridgeRuntimeConfig(...args),
  postToBrowserBridge: (...args: unknown[]) => mockPostToBrowserBridge(...args),
  getFromBrowserBridge: (...args: unknown[]) => mockGetFromBrowserBridge(...args),
}));

import { createBrowserBridgeApi } from '../code-browser-bridge';

describe('createBrowserBridgeApi.waitFor', () => {
  beforeEach(() => {
    mockResolveBrowserBridgeRuntimeConfig.mockReset();
    mockPostToBrowserBridge.mockReset();
    mockGetFromBrowserBridge.mockReset();

    mockResolveBrowserBridgeRuntimeConfig.mockReturnValue({
      baseUrl: 'http://127.0.0.1:3001',
      token: 'test-token',
      source: 'env',
    });
    mockPostToBrowserBridge.mockResolvedValue({ ok: true });
  });

  test('propagates the requested wait timeout to both bridge body and transport timeout', async () => {
    const api = createBrowserBridgeApi();

    await api.waitFor(['收藏页面', 'My Saved Items'], { timeout: 120_000 });

    expect(mockPostToBrowserBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:3001',
        token: 'test-token',
      }),
      '/v1/pages/wait-for',
      {
        text: ['收藏页面', 'My Saved Items'],
        timeoutMs: 120_000,
      },
      {
        timeoutMs: 120_000,
      },
    );
  });

  test('raises short wait timeouts to a safer floor for slow pages', async () => {
    const api = createBrowserBridgeApi();

    await api.waitFor('Hi Nancy', { timeout: 10_000 });

    expect(mockPostToBrowserBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:3001',
        token: 'test-token',
      }),
      '/v1/pages/wait-for',
      {
        text: ['Hi Nancy'],
        timeoutMs: 30_000,
      },
      {
        timeoutMs: 30_000,
      },
    );
  });

  test('reuses the resolved pageId for later page actions in the same browser api instance', async () => {
    mockPostToBrowserBridge
      .mockResolvedValueOnce({ ok: true, pageId: 'page-wishlist' })
      .mockResolvedValueOnce({ ok: true, pageId: 'page-wishlist', title: 'My Saved Items', lines: ['item 1'] });

    const api = createBrowserBridgeApi();

    await api.navigate('https://www.gigab2b.com/index.php?route=account/wishlist');
    await api.snapshot();

    expect(mockPostToBrowserBridge).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:3001',
        token: 'test-token',
      }),
      '/v1/pages/navigate',
      {
        url: 'https://www.gigab2b.com/index.php?route=account/wishlist',
        type: 'url',
      },
      {
        timeoutMs: 120_000,
      },
    );
    expect(mockPostToBrowserBridge).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:3001',
        token: 'test-token',
      }),
      '/v1/pages/snapshot',
      {
        pageId: 'page-wishlist',
      },
      {
        signal: undefined,
      },
    );
  });

  test('propagates background mode so workflow browser actions can stay offscreen', async () => {
    mockPostToBrowserBridge.mockResolvedValueOnce({ ok: true, pageId: 'page-hidden' });

    const api = createBrowserBridgeApi({ background: true });

    await api.navigate('https://www.gigab2b.com/index.php?route=account/login');

    expect(mockPostToBrowserBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:3001',
        token: 'test-token',
      }),
      '/v1/pages/navigate',
      {
        url: 'https://www.gigab2b.com/index.php?route=account/login',
        type: 'url',
        background: true,
      },
      {
        timeoutMs: 120_000,
      },
    );
  });

  test('resolves legacy click-by-text targets through snapshot before clicking', async () => {
    mockPostToBrowserBridge
      .mockResolvedValueOnce({ ok: true, pageId: 'page-wishlist', title: 'My Saved Items', lines: ['[e21] 下载数据', '[e22] 确认'] })
      .mockResolvedValueOnce({ ok: true, pageId: 'page-wishlist' });

    const api = createBrowserBridgeApi();

    await api.click({ text: '下载数据' });

    expect(mockPostToBrowserBridge).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:3001',
        token: 'test-token',
      }),
      '/v1/pages/snapshot',
      {},
      {
        signal: undefined,
      },
    );

    expect(mockPostToBrowserBridge).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:3001',
        token: 'test-token',
      }),
      '/v1/pages/click',
      {
        pageId: 'page-wishlist',
        uid: 'e21',
      },
      {
        signal: undefined,
      },
    );
  });

  test('enriches waitFor timeout errors with page diagnostics', async () => {
    mockPostToBrowserBridge
      .mockRejectedValueOnce(new Error('Browser bridge request timed out (120000ms): /v1/pages/wait-for'))
      .mockResolvedValueOnce({
        ok: true,
        pageId: 'page-wishlist',
        title: 'Wishlist',
        lines: ['My Saved Items', '高级筛选', '收起'],
      });
    mockGetFromBrowserBridge.mockResolvedValueOnce({
      ok: true,
      activePageId: 'page-wishlist',
      page: {
        pageId: 'page-wishlist',
        title: 'GIGAB2B Wishlist',
        url: 'https://www.gigab2b.com/index.php?route=account/wishlist',
      },
    });

    const api = createBrowserBridgeApi();

    await expect(api.waitFor('My Saved Items', { timeout: 120_000 })).rejects.toThrow(
      'action=waitFor | currentPage=GIGAB2B Wishlist @ https://www.gigab2b.com/index.php?route=account/wishlist | activePageId=page-wishlist | snapshotTitle=Wishlist | snapshotPreview=My Saved Items',
    );
  });
});
