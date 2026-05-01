import type { BrowserBridgeRuntimeConfig } from '../bridge-client';
import { checkBrowserBridgeReady, postToBrowserBridge, resolveBrowserBridgeRuntimeConfig } from '../bridge-client';

describe('postToBrowserBridge', () => {
  const config: BrowserBridgeRuntimeConfig = {
    baseUrl: 'http://127.0.0.1:3001',
    token: 'test-token',
    source: 'env',
  };
  const originalFetch = global.fetch;
  const originalBridgeUrl = process.env.LUMOS_BROWSER_BRIDGE_URL;
  const originalBridgeToken = process.env.LUMOS_BROWSER_BRIDGE_TOKEN;
  const originalBrowserContextId = process.env.LUMOS_BROWSER_CONTEXT_ID;
  const originalBrowserLockOwner = process.env.LUMOS_BROWSER_LOCK_OWNER;
  const originalSessionId = process.env.LUMOS_SESSION_ID;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    if (originalBridgeUrl === undefined) {
      delete process.env.LUMOS_BROWSER_BRIDGE_URL;
    } else {
      process.env.LUMOS_BROWSER_BRIDGE_URL = originalBridgeUrl;
    }
    if (originalBridgeToken === undefined) {
      delete process.env.LUMOS_BROWSER_BRIDGE_TOKEN;
    } else {
      process.env.LUMOS_BROWSER_BRIDGE_TOKEN = originalBridgeToken;
    }
    if (originalBrowserContextId === undefined) {
      delete process.env.LUMOS_BROWSER_CONTEXT_ID;
    } else {
      process.env.LUMOS_BROWSER_CONTEXT_ID = originalBrowserContextId;
    }
    if (originalBrowserLockOwner === undefined) {
      delete process.env.LUMOS_BROWSER_LOCK_OWNER;
    } else {
      process.env.LUMOS_BROWSER_LOCK_OWNER = originalBrowserLockOwner;
    }
    if (originalSessionId === undefined) {
      delete process.env.LUMOS_SESSION_ID;
    } else {
      process.env.LUMOS_SESSION_ID = originalSessionId;
    }
    jest.restoreAllMocks();
  });

  test('uses a longer default transport timeout for navigate requests', async () => {
    global.fetch = jest.fn((_input: string | URL | Request, init?: RequestInit) => new Promise((_, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error('missing abort signal'));
        return;
      }
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) as unknown as typeof fetch;

    const request = postToBrowserBridge(
      config,
      '/v1/pages/navigate',
      { url: 'https://example.com/login', type: 'url' },
    );
    const rejectionSpy = jest.fn();
    void request.catch(rejectionSpy);

    await jest.advanceTimersByTimeAsync(30_000);
    expect(rejectionSpy).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(90_000);
    await expect(request).rejects.toThrow('Browser bridge request timed out (120000ms): /v1/pages/navigate');
  });

  test('routes bridge requests through the configured browser context', async () => {
    const contextConfig: BrowserBridgeRuntimeConfig = {
      ...config,
      browserContextId: 'adspower:profile-001',
    };
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;

    await postToBrowserBridge(
      contextConfig,
      '/v1/pages/navigate',
      { url: 'https://example.com', type: 'url' },
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/v1/pages/navigate?browserContextId=adspower%3Aprofile-001',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-lumos-browser-context-id': 'adspower:profile-001',
        }),
      }),
    );
  });

  test('sends lock owner headers for runtime browser operations', async () => {
    const contextConfig: BrowserBridgeRuntimeConfig = {
      ...config,
      browserContextId: 'adspower:profile-001',
      lockOwnerId: 'session-001',
    };
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;

    await postToBrowserBridge(
      contextConfig,
      '/v1/pages/click',
      { pageId: 'page-1', uid: 'e1' },
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/v1/pages/click?browserContextId=adspower%3Aprofile-001',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-lumos-browser-owner-id': 'session-001',
        }),
      }),
    );
  });

  test('uses the configured browser context for health checks', async () => {
    const contextConfig: BrowserBridgeRuntimeConfig = {
      ...config,
      browserContextId: 'external-cdp:debug-9222',
    };
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ ready: true }), { status: 200 })) as unknown as typeof fetch;

    await expect(checkBrowserBridgeReady(contextConfig)).resolves.toEqual({
      ready: true,
      status: 200,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/health?browserContextId=external-cdp%3Adebug-9222',
    );
  });

  test('allows callers to override an environment browser context', () => {
    process.env.LUMOS_BROWSER_BRIDGE_URL = 'http://127.0.0.1:3001';
    process.env.LUMOS_BROWSER_BRIDGE_TOKEN = 'test-token';
    process.env.LUMOS_BROWSER_CONTEXT_ID = 'adspower:profile-001';

    expect(resolveBrowserBridgeRuntimeConfig({ browserContextId: 'embedded:default' })).toEqual({
      baseUrl: 'http://127.0.0.1:3001',
      token: 'test-token',
      source: 'env',
      browserContextId: 'embedded:default',
    });
  });

  test('uses session id as browser lock owner by default', () => {
    process.env.LUMOS_BROWSER_BRIDGE_URL = 'http://127.0.0.1:3001';
    process.env.LUMOS_BROWSER_BRIDGE_TOKEN = 'test-token';
    process.env.LUMOS_SESSION_ID = 'session-from-env';

    expect(resolveBrowserBridgeRuntimeConfig()).toEqual({
      baseUrl: 'http://127.0.0.1:3001',
      token: 'test-token',
      source: 'env',
      lockOwnerId: 'session-from-env',
    });
  });
});
