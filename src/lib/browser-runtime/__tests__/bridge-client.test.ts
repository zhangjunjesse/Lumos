import type { BrowserBridgeRuntimeConfig } from '../bridge-client';
import { postToBrowserBridge } from '../bridge-client';

describe('postToBrowserBridge', () => {
  const config: BrowserBridgeRuntimeConfig = {
    baseUrl: 'http://127.0.0.1:3001',
    token: 'test-token',
    source: 'env',
  };
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
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
});
